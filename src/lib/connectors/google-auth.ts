import { ConnectorError, type ConnectorContext, type ConnectorCredentials } from './types';
import { GOOGLE_TOKEN_ENDPOINT, mapGoogleError } from './google-errors';

/**
 * Ciclo de vida do token do Google: troca do code, refresh e revogacao.
 *
 * Nenhuma funcao aqui loga token, nem o inclui em mensagem de erro.
 * Ver docs/04-seguranca.md
 */

const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Renovamos com folga: um token que vence durante o sync derruba a pagina. */
const REFRESH_MARGIN_MS = 120_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  /**
   * Escopos que o Google CONCEDEU de fato — pode ser menos do que pedimos,
   * porque o usuario pode desmarcar permissoes na tela de consentimento.
   * Confiar no que pedimos, e nao no que veio, faria o app achar que pode
   * escrever quando nao pode.
   */
  scope?: string;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleOAuthConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleOAuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI no .env ' +
        '(crie as credenciais em https://console.cloud.google.com)',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    // O corpo do erro do Google nao contem segredo, mas contem o motivo
    // (invalid_grant, redirect_uri_mismatch), que e o que o usuario precisa.
    const detalhe = await response.text().catch(() => '');
    const erro = mapGoogleError(response.status, response.headers.get('retry-after'));
    throw new ConnectorError(erro.code, `${erro.message}: ${detalhe.slice(0, 300)}`);
  }

  return (await response.json()) as TokenResponse;
}

function toCredentials(token: TokenResponse, refreshAnterior?: string): ConnectorCredentials {
  return {
    accessToken: token.access_token,
    // No refresh o Google nao reenvia o refresh_token: perder o antigo aqui
    // obrigaria o usuario a reautorizar a cada hora.
    refreshToken: token.refresh_token ?? refreshAnterior,
    expiresAt: new Date(Date.now() + token.expires_in * 1_000),
    grantedScopes: token.scope ? token.scope.split(' ').filter(Boolean) : undefined,
  };
}

/** Troca o `code` do callback pelas credenciais. Exige o verifier do PKCE. */
export async function exchangeGoogleCode(params: {
  code: string;
  codeVerifier: string;
  config: GoogleOAuthConfig;
}): Promise<ConnectorCredentials> {
  const token = await postToken(
    new URLSearchParams({
      code: params.code,
      client_id: params.config.clientId,
      client_secret: params.config.clientSecret,
      redirect_uri: params.config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
    }),
  );

  if (!token.refresh_token) {
    throw new ConnectorError(
      'PERMANENT',
      'O Google nao devolveu refresh_token. Remova o acesso do app em ' +
        'myaccount.google.com/permissions e conecte novamente.',
    );
  }

  return toCredentials(token);
}

export async function refreshGoogleToken(
  refreshToken: string,
  config: GoogleOAuthConfig,
): Promise<ConnectorCredentials> {
  const token = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  );
  return toCredentials(token, refreshToken);
}

export function isTokenExpired(credentials: ConnectorCredentials, now = new Date()): boolean {
  if (!credentials.accessToken) return true;
  if (!credentials.expiresAt) return false;
  return credentials.expiresAt.getTime() - REFRESH_MARGIN_MS <= now.getTime();
}

/**
 * Devolve um access token valido, renovando quando necessario e avisando o
 * motor para persistir as credenciais novas (cifradas).
 */
export async function ensureGoogleAccessToken(ctx: ConnectorContext): Promise<string> {
  if (!isTokenExpired(ctx.credentials)) {
    return ctx.credentials.accessToken as string;
  }

  if (!ctx.credentials.refreshToken) {
    throw new ConnectorError(
      'AUTH_EXPIRED',
      'Token expirado e sem refresh_token; a conta precisa ser reconectada',
    );
  }

  const renovadas = await refreshGoogleToken(
    ctx.credentials.refreshToken,
    googleOAuthConfigFromEnv(),
  );

  // Muta o contexto para as chamadas seguintes da mesma execucao ja usarem o
  // token novo, sem esperar o round-trip de persistencia.
  ctx.credentials = renovadas;
  await ctx.onCredentialsRefreshed?.(renovadas);

  return renovadas.accessToken as string;
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw mapGoogleError(response.status, response.headers.get('retry-after'));
  }
  const perfil = (await response.json()) as { email?: string };
  if (!perfil.email) {
    throw new ConnectorError('PERMANENT', 'O Google nao devolveu o e-mail da conta');
  }
  return perfil.email;
}

/** Revoga o acesso no Google ao desconectar a conta, sem deixar token vivo. */
export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => {
    // Revogacao e melhor-esforco: se falhar, apagamos o cache local mesmo assim.
  });
}
