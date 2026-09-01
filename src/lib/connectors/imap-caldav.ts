import type {
  Connector,
  ConnectorCapabilities,
  ConnectorContext,
  FetchOptions,
  Page,
  RawCalendar,
  RawEvent,
  RawMailbox,
  RawMessage,
  RawAttachment,
} from './types';
import { ConnectorError } from './types';
import {
  fetchImapMessageBody,
  fetchImapMessages,
  listImapMailboxes,
  verifyImapConnection,
  type ImapConnectionConfig,
} from './imap-client';
import { encodeImapCursor } from './imap-normalize';
import {
  fetchCaldavEvents,
  listCaldavCalendars,
  verifyCaldavConnection,
  type CaldavConnectionConfig,
} from './caldav-client';
import { parseContainerCursor, serializeContainerCursor } from './container-cursor';
import { envNumero } from '@/lib/env';

/**
 * Conector IMAP + CalDAV. Atende o Apple iCloud e qualquer provedor generico
 * (Fastmail, Zoho, dominio corporativo, servidor proprio).
 *
 * Do ponto de vista do nucleo, o iCloud e apenas este conector com defaults
 * pre-preenchidos — mesma implementacao, configuracao diferente.
 * Ver docs/03-conectores.md
 *
 * Sem OAuth: usa IMAP (RFC 3501, via imapflow) para e-mail e CalDAV (RFC
 * 4791/6578, via tsdav + ical.js para o ICS) para calendario, com
 * usuario/senha (senha de app, nunca a senha principal da conta).
 */

export interface ImapCaldavConfig {
  imapHost: string;
  imapPort: number;
  /** TLS e obrigatorio: certificado invalido e erro, nao aviso. */
  imapSecure: boolean;
  caldavUrl: string;
  /** Preenchido pela descoberta PROPFIND -> calendar-home-set. */
  caldavHomeSet?: string;
}

/** Defaults do iCloud. Exige senha especifica de app (appleid.apple.com). */
export const APPLE_PRESET: ImapCaldavConfig = {
  imapHost: 'imap.mail.me.com',
  imapPort: 993,
  imapSecure: true,
  caldavUrl: 'https://caldav.icloud.com',
};

/**
 * Sem push confiavel e sem busca no servidor: o agendador compensa com polling
 * mais frequente e a busca acontece no cache local do Postgres.
 */
export const imapCaldavCapabilities: ConnectorCapabilities = {
  mail: true,
  calendar: true,
  contacts: false,
  incrementalSync: 'etag-poll',
  push: false,
  serverSideSearch: false,
  write: false,
  // O IMAP sabe baixar parte de mensagem, mas ESTE conector nunca foi
  // validado contra servidor real (ver docs/03-conectores.md). Declarar
  // false mantem o painel financeiro honesto: ele simplesmente nao tenta,
  // em vez de tentar e falhar em silencio.
  attachments: false,
  pollIntervalSeconds: 900,
};

const APPLE_DOMAINS = ['icloud.com', 'me.com', 'mac.com'];

/** Usado tambem para decidir o provider (APPLE vs IMAP_CALDAV) ao conectar. */
export function isAppleDomain(domain: string): boolean {
  return APPLE_DOMAINS.includes(domain.trim().toLowerCase());
}

/**
 * Autodiscovery por convencao, antes de pedir os dados ao usuario.
 * A ordem importa: preset conhecido primeiro, convencao depois.
 */
export function guessConfigForDomain(domain: string): ImapCaldavConfig {
  const normalized = domain.trim().toLowerCase();
  if (isAppleDomain(normalized)) {
    return { ...APPLE_PRESET };
  }
  return {
    imapHost: `imap.${normalized}`,
    imapPort: 993,
    imapSecure: true,
    caldavUrl: `https://${normalized}/.well-known/caldav`,
  };
}

export function domainFromEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at === -1 || at === email.length - 1) {
    throw new Error(`Endereco de e-mail invalido: ${email}`);
  }
  return email.slice(at + 1).toLowerCase();
}

function imapConfigDe(ctx: ConnectorContext): ImapConnectionConfig {
  const config = ctx.config as unknown as ImapCaldavConfig;
  if (!ctx.credentials.username || !ctx.credentials.password) {
    throw new ConnectorError('AUTH_EXPIRED', 'Conexao sem usuario/senha; reconecte a conta');
  }
  return {
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    username: ctx.credentials.username,
    password: ctx.credentials.password,
  };
}

function caldavConfigDe(ctx: ConnectorContext): CaldavConnectionConfig {
  const config = ctx.config as unknown as ImapCaldavConfig;
  if (!ctx.credentials.username || !ctx.credentials.password) {
    throw new ConnectorError('AUTH_EXPIRED', 'Conexao sem usuario/senha; reconecte a conta');
  }
  return {
    serverUrl: config.caldavUrl,
    username: ctx.credentials.username,
    password: ctx.credentials.password,
  };
}

function janelaPadrao(): { since: Date; until: Date } {
  const mesesPassado = envNumero(process.env.SYNC_CALENDAR_PAST_MONTHS, 1);
  const mesesFuturo = envNumero(process.env.SYNC_CALENDAR_FUTURE_MONTHS, 12);

  const since = new Date();
  since.setMonth(since.getMonth() - mesesPassado);
  const until = new Date();
  until.setMonth(until.getMonth() + mesesFuturo);

  return { since, until };
}

export const imapCaldavConnector: Connector = {
  provider: 'IMAP_CALDAV',
  capabilities: imapCaldavCapabilities,

  async verify(ctx) {
    // As duas pernas do conector (mail: true, calendar: true) precisam
    // funcionar: um provedor so-IMAP sem CalDAV nao e suportado nesta fase.
    // Ver limitacao documentada em docs/06-roadmap.md.
    await verifyImapConnection(imapConfigDe(ctx));
    await verifyCaldavConnection(caldavConfigDe(ctx));
    return { accountEmail: ctx.accountEmail };
  },

  async listMailboxes(ctx): Promise<RawMailbox[]> {
    return listImapMailboxes(imapConfigDe(ctx));
  },

  async listCalendars(ctx): Promise<RawCalendar[]> {
    return listCaldavCalendars(caldavConfigDe(ctx));
  },

  async fetchMessages(ctx, _options: FetchOptions): Promise<Page<RawMessage>> {
    const cursorAnterior = parseContainerCursor(_options.cursor);
    const config = imapConfigDe(ctx);

    const pastas = await listImapMailboxes(config);
    // INBOX pela triagem; SENT porque o perfil de voz da fase 5C e derivado
    // da pasta Enviados (docs/07-agente-de-triagem.md) — sem ela, contas
    // IMAP/Apple ficariam sem perfil. Lixeira e spam continuam fora.
    // Pastas extras so entram se ja tinham cursor de execucao anterior.
    const alvo = pastas.filter(
      (pasta) => pasta.role === 'INBOX' || pasta.role === 'SENT' || cursorAnterior[pasta.providerId],
    );

    const itens: RawMessage[] = [];
    const removidos: string[] = [];
    const tokens: Record<string, string> = {};

    for (const pasta of alvo) {
      const resultado = await fetchImapMessages(config, pasta.providerId, cursorAnterior[pasta.providerId]);
      itens.push(...resultado.items);
      removidos.push(...resultado.deletedProviderIds);
      tokens[pasta.providerId] = encodeImapCursor(resultado.cursor);
    }

    return { items: itens, deletedProviderIds: removidos, cursor: serializeContainerCursor(tokens) };
  },

  async fetchEvents(ctx, options): Promise<Page<RawEvent>> {
    const cursorAnterior = parseContainerCursor(options.cursor);
    const config = caldavConfigDe(ctx);
    const janela = options.window ?? janelaPadrao();

    const calendarios = await listCaldavCalendars(config);

    const itens: RawEvent[] = [];
    const removidos: string[] = [];
    const tokens: Record<string, string> = {};

    for (const calendario of calendarios) {
      const resultado = await fetchCaldavEvents(
        config,
        calendario.providerId,
        cursorAnterior[calendario.providerId],
        janela,
        ctx.accountEmail,
      );
      itens.push(...resultado.items);
      removidos.push(...resultado.deletedProviderIds);
      if (resultado.syncToken) tokens[calendario.providerId] = resultado.syncToken;
    }

    return { items: itens, deletedProviderIds: removidos, cursor: serializeContainerCursor(tokens) };
  },

  async fetchMessageBody(ctx, providerId) {
    // O providerId de mensagem carrega so o UID; precisamos redescobrir a
    // pasta. Como so sincronizamos INBOX por padrao, comecamos por ali.
    return fetchImapMessageBody(imapConfigDe(ctx), 'INBOX', providerId);
  },
};

/** O conector Apple e o mesmo IMAP/CalDAV, so muda o provider registrado. */
export const appleConnector: Connector = {
  ...imapCaldavConnector,
  provider: 'APPLE',
};
