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
} from './types';
import { ConnectorError } from './types';

/**
 * Conector IMAP + CalDAV. Atende o Apple iCloud e qualquer provedor generico
 * (Fastmail, Zoho, dominio corporativo, servidor proprio).
 *
 * Do ponto de vista do nucleo, o iCloud e apenas este conector com defaults
 * pre-preenchidos — mesma implementacao, configuracao diferente.
 * Ver docs/03-conectores.md
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
  pollIntervalSeconds: 900,
};

/**
 * Autodiscovery por convencao, antes de pedir os dados ao usuario.
 * A ordem importa: preset conhecido primeiro, convencao depois.
 */
export function guessConfigForDomain(domain: string): ImapCaldavConfig {
  const normalized = domain.trim().toLowerCase();
  if (['icloud.com', 'me.com', 'mac.com'].includes(normalized)) {
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

function naoImplementado(recurso: string): never {
  throw new ConnectorError(
    'PERMANENT',
    `Sync de ${recurso} via IMAP/CalDAV entra na fase 2 do roadmap (docs/06-roadmap.md)`,
  );
}

export const imapCaldavConnector: Connector = {
  provider: 'IMAP_CALDAV',
  capabilities: imapCaldavCapabilities,

  async verify(_ctx: ConnectorContext) {
    return naoImplementado('verificacao');
  },
  async listMailboxes(_ctx: ConnectorContext): Promise<RawMailbox[]> {
    return naoImplementado('pastas');
  },
  async listCalendars(_ctx: ConnectorContext): Promise<RawCalendar[]> {
    return naoImplementado('calendarios');
  },
  async fetchMessages(_ctx: ConnectorContext, _o: FetchOptions): Promise<Page<RawMessage>> {
    return naoImplementado('mensagens');
  },
  async fetchEvents(_ctx: ConnectorContext, _o: FetchOptions): Promise<Page<RawEvent>> {
    return naoImplementado('eventos');
  },
  async fetchMessageBody(_ctx: ConnectorContext, _id: string) {
    return naoImplementado('corpo de mensagem');
  },
};

/** O conector Apple e o mesmo IMAP/CalDAV, so muda o provider registrado. */
export const appleConnector: Connector = {
  ...imapCaldavConnector,
  provider: 'APPLE',
};
