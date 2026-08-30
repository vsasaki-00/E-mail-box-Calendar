import type { RawMailbox, RawMessage } from './types';

/**
 * Traducao do dialeto IMAP para o modelo canonico. Funcoes puras: sem rede.
 *
 * Diferente do Gmail e do Graph, o imapflow ja resolve o papel especial da
 * pasta com fallback por nome localizado — ver `specialUseSource: 'name'` em
 * node_modules/imapflow/lib/imap-flow.d.ts. Nao precisamos reimplementar essa
 * heuristica: so traduzimos a flag `\Sent`/`\Trash`/... que o imapflow ja
 * calculou para o nosso enum de papel.
 */

export function mailboxRoleFromSpecialUse(specialUse?: string): RawMailbox['role'] {
  switch (specialUse) {
    case '\\Inbox':
      return 'INBOX';
    case '\\Sent':
      return 'SENT';
    case '\\Trash':
      return 'TRASH';
    case '\\Junk':
      return 'SPAM';
    default:
      return 'CUSTOM';
  }
}

interface ImapEnvelopeAddress {
  name?: string;
  address?: string;
}

interface ImapEnvelope {
  date?: Date;
  subject?: string;
  messageId?: string;
  from?: ImapEnvelopeAddress[];
  to?: ImapEnvelopeAddress[];
  cc?: ImapEnvelopeAddress[];
}

export interface ImapFetchedMessage {
  uid: number;
  envelope?: ImapEnvelope;
  flags?: Set<string>;
  internalDate?: Date | string;
  threadId?: string;
  bodyStructure?: { childNodes?: unknown[] };
}

function enderecos(lista?: ImapEnvelopeAddress[]): string[] {
  return (lista ?? [])
    .map((item) => item.address?.trim().toLowerCase())
    .filter((endereco): endereco is string => Boolean(endereco));
}

/** IMAP nao tem um campo hasAttachments pronto: aproxima por bodyStructure ter mais de um nó. */
function temProvavelAnexo(bodyStructure?: { childNodes?: unknown[] }): boolean {
  return Boolean(bodyStructure?.childNodes && bodyStructure.childNodes.length > 1);
}

export function normalizeImapMessage(
  mensagem: ImapFetchedMessage,
  mailboxProviderId: string,
): RawMessage {
  const envelope = mensagem.envelope;
  const flags = mensagem.flags ?? new Set<string>();
  const from = envelope?.from?.[0];

  return {
    providerId: String(mensagem.uid),
    providerThreadId: mensagem.threadId,
    rfcMessageId: envelope?.messageId,
    mailboxProviderId,
    subject: envelope?.subject,
    fromName: from?.name,
    fromEmail: from?.address?.trim().toLowerCase(),
    toEmails: enderecos(envelope?.to),
    ccEmails: enderecos(envelope?.cc),
    receivedAt: mensagem.internalDate
      ? new Date(mensagem.internalDate)
      : (envelope?.date ?? new Date()),
    // Ausência da flag \Seen é o que marca "não lido" no IMAP.
    isRead: flags.has('\\Seen'),
    isFlagged: flags.has('\\Flagged'),
    hasAttachments: temProvavelAnexo(mensagem.bodyStructure),
    labels: [],
  };
}

/**
 * Cursor de uma pasta IMAP: UIDVALIDITY (invalida tudo se mudar — servidor
 * reindexou a pasta), o maior UID já visto, e o MODSEQ mais alto quando o
 * servidor suporta CONDSTORE (permite `changedSince` para pegar so o que
 * mudou, inclusive flags, sem precisar rastrear cada UID individualmente).
 */
export interface ImapMailboxCursor {
  uidValidity: string;
  lastUid: number;
  highestModseq?: string;
}

export function encodeImapCursor(cursor: ImapMailboxCursor): string {
  return JSON.stringify(cursor);
}

export function decodeImapCursor(raw?: string): ImapMailboxCursor | undefined {
  if (!raw) return undefined;
  try {
    const valor = JSON.parse(raw) as Partial<ImapMailboxCursor>;
    if (typeof valor.uidValidity !== 'string' || typeof valor.lastUid !== 'number') return undefined;
    return {
      uidValidity: valor.uidValidity,
      lastUid: valor.lastUid,
      highestModseq: typeof valor.highestModseq === 'string' ? valor.highestModseq : undefined,
    };
  } catch {
    // Cursor corrompido vira full sync, que é sempre seguro.
    return undefined;
  }
}
