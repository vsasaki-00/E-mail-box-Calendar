import { ImapFlow } from 'imapflow';
import type { RawMailbox, RawMessage } from './types';
import { ConnectorError } from './types';
import { mapImapError } from './imap-caldav-errors';
import {
  decodeImapCursor,
  mailboxRoleFromSpecialUse,
  normalizeImapMessage,
  type ImapMailboxCursor,
} from './imap-normalize';

/**
 * Fina camada sobre o imapflow: abre/fecha conexao, resolve pastas e busca
 * mensagens. Ver docs/03-conectores.md — a heuristica de nome localizado de
 * pasta ja vem do imapflow (`specialUseSource: 'name'`), nao reimplementada
 * aqui.
 */

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

/** Mensagens dentro desta janela (em dias) entram no full sync. */
const DEFAULT_MAIL_WINDOW_DAYS = 90;

async function withClient<T>(
  config: ImapConnectionConfig,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    // Log proprio desligado: nao queremos credenciais nem conteudo de
    // e-mail em log. Ver docs/04-seguranca.md
    logger: false,
    // Evita a conexao ficar presa em IDLE quando so precisamos de um
    // request pontual e encerrar.
    disableAutoIdle: true,
  });

  try {
    await client.connect();
  } catch (error) {
    throw mapImapError(error);
  }

  try {
    return await fn(client);
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw mapImapError(error);
  } finally {
    // logout() tenta um LOGOUT limpo; se a conexao ja caiu, cai para close().
    await client.logout().catch(() => client.close());
  }
}

export async function verifyImapConnection(config: ImapConnectionConfig): Promise<void> {
  await withClient(config, async () => {
    // Conectar com sucesso ja e a verificacao: nao ha "whoami" em IMAP puro.
  });
}

export async function listImapMailboxes(config: ImapConnectionConfig): Promise<RawMailbox[]> {
  return withClient(config, async (client) => {
    const pastas = await client.list();
    return pastas
      // Pastas nao selecionaveis (\Noselect) sao nos de agrupamento, sem
      // mensagens de verdade — ex.: "[Gmail]" sem conteudo proprio.
      .filter((pasta) => !pasta.flags.has('\\Noselect'))
      .map((pasta) => ({
        providerId: pasta.path,
        name: pasta.name,
        role: pasta.path === 'INBOX' ? 'INBOX' : mailboxRoleFromSpecialUse(pasta.specialUse),
      }));
  });
}

export interface ImapFetchResult {
  items: RawMessage[];
  deletedProviderIds: string[];
  cursor: ImapMailboxCursor;
}

/**
 * Busca mensagens de uma pasta. Sem cursor: full sync pela janela de dias.
 * Com cursor: usa CONDSTORE (`changedSince`) quando o servidor suporta —
 * pega tanto mensagens novas quanto mudanças de flag em mensagens antigas;
 * sem CONDSTORE, cai para "UID maior que o ultimo visto" (nao detecta
 * mudanca de flag em mensagem antiga nem exclusão, limitação aceita e
 * documentada em docs/03-conectores.md).
 */
export async function fetchImapMessages(
  config: ImapConnectionConfig,
  mailboxPath: string,
  previousCursor: string | undefined,
  windowDays = DEFAULT_MAIL_WINDOW_DAYS,
): Promise<ImapFetchResult> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
    try {
      const mailbox = client.mailbox;
      if (!mailbox) {
        throw new ConnectorError('NOT_FOUND', `Pasta ${mailboxPath} não pôde ser aberta`);
      }

      const uidValidity = mailbox.uidValidity.toString();
      const cursorAnterior = decodeImapCursor(previousCursor);

      // UIDVALIDITY mudou: o servidor reindexou a pasta, todo UID antigo
      // perdeu validade. Full sync e a unica saida segura.
      if (cursorAnterior && cursorAnterior.uidValidity !== uidValidity) {
        throw new ConnectorError('CURSOR_EXPIRED', `UIDVALIDITY da pasta ${mailboxPath} mudou`);
      }

      const suportaCondstore = client.capabilities.has('CONDSTORE');
      const items: RawMessage[] = [];

      if (cursorAnterior && suportaCondstore && cursorAnterior.highestModseq) {
        // Incremental via CONDSTORE: pega tudo que mudou (novo ou flag
        // alterada) desde o ultimo modseq conhecido, numa unica consulta.
        for await (const mensagem of client.fetch(
          '1:*',
          { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, threadId: true },
          { changedSince: BigInt(cursorAnterior.highestModseq) },
        )) {
          items.push(normalizeImapMessage(mensagem, mailboxPath));
        }
      } else if (cursorAnterior) {
        // Sem CONDSTORE: so pegamos mensagens novas (UID > ultimo visto).
        const uids = await client.search({ uid: `${cursorAnterior.lastUid + 1}:*` }, { uid: true });
        if (uids && uids.length > 0) {
          for await (const mensagem of client.fetch(
            uids,
            { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, threadId: true },
            { uid: true },
          )) {
            items.push(normalizeImapMessage(mensagem, mailboxPath));
          }
        }
      } else {
        // Full sync: tudo recebido dentro da janela configurada.
        const desde = new Date();
        desde.setDate(desde.getDate() - windowDays);
        const uids = await client.search({ since: desde }, { uid: true });
        if (uids && uids.length > 0) {
          for await (const mensagem of client.fetch(
            uids,
            { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, threadId: true },
            { uid: true },
          )) {
            items.push(normalizeImapMessage(mensagem, mailboxPath));
          }
        }
      }

      const cursor: ImapMailboxCursor = {
        uidValidity,
        lastUid: Math.max(cursorAnterior?.lastUid ?? 0, mailbox.uidNext - 1),
        highestModseq: mailbox.highestModseq ? mailbox.highestModseq.toString() : undefined,
      };

      return { items, deletedProviderIds: [], cursor };
    } finally {
      lock.release();
    }
  });
}

export async function fetchImapMessageBody(
  config: ImapConnectionConfig,
  mailboxPath: string,
  uid: string,
): Promise<{ text?: string; html?: string }> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
    try {
      const mensagem = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!mensagem || !mensagem.source) return {};

      // O corpo completo (texto/HTML) exige parsing MIME de verdade, fora do
      // escopo deste conector — expor o RFC822 bruto como texto e suficiente
      // para leitura sob demanda; renderizacao rica fica para quando a UI de
      // leitura de corpo for construida.
      return { text: mensagem.source.toString('utf8') };
    } finally {
      lock.release();
    }
  });
}

