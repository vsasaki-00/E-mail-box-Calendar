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
 * Conector Microsoft (Outlook + Calendar via Graph). Ver docs/03-conectores.md
 *
 * Estado: OAuth e mapeamento de erro implementados; sincronizacao entra na
 * fase 2 do roadmap.
 */

export const MICROSOFT_SCOPES = [
  'Mail.Read',
  'Calendars.Read',
  'User.Read',
  'offline_access',
] as const;

export const microsoftCapabilities: ConnectorCapabilities = {
  mail: true,
  calendar: true,
  contacts: true,
  incrementalSync: 'delta-token',
  push: true,
  serverSideSearch: true,
  write: false,
  pollIntervalSeconds: 300,
};

export function buildMicrosoftAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** "common" aceita contas pessoais e corporativas. */
  tenant?: string;
}): string {
  const tenant = params.tenant || 'common';
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', MICROSOFT_SCOPES.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * O Graph faz throttling agressivo com 429 + Retry-After. Ignorar esse header
 * derruba a conexao inteira por horas, entao ele e sempre respeitado.
 */
export function mapMicrosoftError(
  status: number,
  retryAfterHeader?: string | null,
): ConnectorError {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  switch (status) {
    case 401:
      return new ConnectorError('AUTH_EXPIRED', 'Token do Microsoft Graph expirado');
    case 403:
      return new ConnectorError('PERMANENT', 'Permissao insuficiente no Microsoft Graph');
    case 404:
      return new ConnectorError('NOT_FOUND', 'Recurso nao encontrado no Graph');
    case 410:
      return new ConnectorError('CURSOR_EXPIRED', 'deltaLink expirado; requer full sync');
    case 429:
      return new ConnectorError('RATE_LIMITED', 'Throttling do Graph', retryAfter ?? 30);
    default:
      if (status >= 500) {
        return new ConnectorError('TRANSIENT', `Erro ${status} no Graph`, retryAfter ?? 10);
      }
      return new ConnectorError('PERMANENT', `Erro ${status} no Graph`);
  }
}

function naoImplementado(recurso: string): never {
  throw new ConnectorError(
    'PERMANENT',
    `Sync de ${recurso} do Microsoft entra na fase 2 do roadmap (docs/06-roadmap.md)`,
  );
}

export const microsoftConnector: Connector = {
  provider: 'MICROSOFT',
  capabilities: microsoftCapabilities,

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
