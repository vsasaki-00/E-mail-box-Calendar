import { randomBytes, createHash } from 'node:crypto';
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
 * Conector Google (Gmail + Google Calendar). Ver docs/03-conectores.md
 *
 * Estado: OAuth e mapeamento de erro implementados; a sincronizacao entra na
 * fase 1 do roadmap. Os metodos de fetch falham de forma explicita em vez de
 * devolver dados vazios, para nao mascarar ausencia de implementacao como
 * "caixa sem mensagens".
 */

/** Fase 1 e somente leitura. Escrita (gmail.modify) entra na fase 4. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export const googleCapabilities: ConnectorCapabilities = {
  mail: true,
  calendar: true,
  contacts: true,
  incrementalSync: 'history-api',
  push: true,
  serverSideSearch: true,
  write: false,
  pollIntervalSeconds: 300,
};

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** PKCE e obrigatorio mesmo no fluxo server-side. Ver docs/04-seguranca.md */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** Sugere a conta na tela de consentimento, util com varias contas Google. */
  loginHint?: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // access_type=offline + prompt=consent garantem o refresh_token: o Google so
  // devolve refresh_token na primeira autorizacao, a menos que forcemos consent.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint);
  return url.toString();
}

/**
 * Traduz status HTTP do Google para o conjunto fechado de erros do nucleo.
 * 410 em Google Calendar significa syncToken invalido -> full sync.
 */
export function mapGoogleError(status: number, retryAfterHeader?: string | null): ConnectorError {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  switch (status) {
    case 401:
      return new ConnectorError('AUTH_EXPIRED', 'Token do Google expirado ou revogado');
    case 403:
      return new ConnectorError('RATE_LIMITED', 'Quota do Google excedida', retryAfter ?? 60);
    case 404:
      return new ConnectorError('NOT_FOUND', 'Recurso nao encontrado no Google');
    case 410:
      return new ConnectorError('CURSOR_EXPIRED', 'syncToken/historyId invalido; requer full sync');
    case 429:
      return new ConnectorError('RATE_LIMITED', 'Rate limit do Google', retryAfter ?? 30);
    default:
      if (status >= 500) {
        return new ConnectorError('TRANSIENT', `Erro ${status} no Google`, retryAfter ?? 10);
      }
      return new ConnectorError('PERMANENT', `Erro ${status} no Google`);
  }
}

function naoImplementado(recurso: string): never {
  throw new ConnectorError(
    'PERMANENT',
    `Sync de ${recurso} do Google entra na fase 1 do roadmap (docs/06-roadmap.md)`,
  );
}

export const googleConnector: Connector = {
  provider: 'GOOGLE',
  capabilities: googleCapabilities,

  async verify(_ctx: ConnectorContext) {
    return naoImplementado('verificacao');
  },
  async listMailboxes(_ctx: ConnectorContext): Promise<RawMailbox[]> {
    return naoImplementado('labels');
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
