import { ConnectorError, type ConnectorContext, type ConnectorCredentials } from './types';
import { MICROSOFT_TOKEN_ENDPOINT_BASE, mapMicrosoftError } from './microsoft-errors';

/**
 * Ciclo de vida do token do Microsoft: troca do code, refresh.
 *
 * Nenhuma funcao aqui loga token, nem o inclui em mensagem de erro.
 * Ver docs/04-seguranca.md
 *
 * Diferenca notavel em relacao ao Google: o Microsoft Identity Platform nao
 * tem um endpoint publico de revogacao de token equivalente ao /revoke do
 * Google. Desconectar aqui apaga o token localmente; o usuario que quiser
 * revogar de fato remove o acesso do app em myaccount.microsoft.com/consent.
 */

const USERINFO_ENDPOINT = 'https://graph.microsoft.com/v1.0/me';

/** Renovamos com folga: um token que vence durante o sync derruba a pagina. */
const REFRESH_MARGIN_MS = 120_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** "common" aceita conta pessoal (Hotmail/Outlook.com) e corporativa/escolar. */
  tenant: string;
}

export function microsoftOAuthConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): MicrosoftOAuthConfig {
  const clientId = env.MICROSOFT_CLIENT_ID;
  const clientSecret = env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = env.MICROSOFT_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Configure MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET e MICROSOFT_REDIRECT_URI no ' +
        '.env (crie o app registration em https://entra.microsoft.com)',
    );
  }
  return { clientId, clientSecret, redirectUri, tenant: env.MICROSOFT_TENANT || 'common' };
}

function tokenEndpoint(tenant: string): string {
  return `${MICROSOFT_TOKEN_ENDPOINT_BASE}/${tenant}/oauth2/v2.0/token`;
}

async function postToken(tenant: string, body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(tokenEndpoint(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    // O corpo do erro do Microsoft (error, error_description) nao contem
    // segredo, mas contem o motivo (invalid_grant, AADSTS...), que e o que o
    // usuario precisa para diagnosticar.
    const detalhe = await response.text().catch(() => '');
    const erro = mapMicrosoftError(response.status, response.headers.get('retry-after'));
    throw new ConnectorError(erro.code, `${erro.message}: ${detalhe.slice(0, 300)}`);
  }

  return (await response.json()) as TokenResponse;
}

function toCredentials(token: TokenResponse, refreshAnterior?: string): ConnectorCredentials {
  return {
    accessToken: token.access_token,
    // O Microsoft normalmente reenvia refresh_token a cada troca, mas por
    // seguranca tratamos como opcional igual ao Google: nunca perder o
    // anterior por conta de uma resposta que o omitiu.
    refreshToken: token.refresh_token ?? refreshAnterior,
    expiresAt: new Date(Date.now() + token.expires_in * 1_000),
  };
}

/** Troca o `code` do callback pelas credenciais. Exige o verifier do PKCE. */
export async function exchangeMicrosoftCode(params: {
  code: string;
  codeVerifier: string;
  config: MicrosoftOAuthConfig;
}): Promise<ConnectorCredentials> {
  const token = await postToken(
    params.config.tenant,
    new URLSearchParams({
      code: params.code,
      client_id: params.config.clientId,
      client_secret: params.config.clientSecret,
      redirect_uri: params.config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
      scope: 'offline_access Mail.Read Calendars.Read User.Read',
    }),
  );

  if (!token.refresh_token) {
    throw new ConnectorError(
      'PERMANENT',
      'O Microsoft nao devolveu refresh_token. Verifique se o escopo offline_access ' +
        'foi solicitado e tente conectar novamente.',
    );
  }

  return toCredentials(token);
}

export async function refreshMicrosoftToken(
  refreshToken: string,
  config: MicrosoftOAuthConfig,
): Promise<ConnectorCredentials> {
  const token = await postToken(
    config.tenant,
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      scope: 'offline_access Mail.Read Calendars.Read User.Read',
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
export async function ensureMicrosoftAccessToken(ctx: ConnectorContext): Promise<string> {
  if (!isTokenExpired(ctx.credentials)) {
    return ctx.credentials.accessToken as string;
  }

  if (!ctx.credentials.refreshToken) {
    throw new ConnectorError(
      'AUTH_EXPIRED',
      'Token expirado e sem refresh_token; a conta precisa ser reconectada',
    );
  }

  const renovadas = await refreshMicrosoftToken(
    ctx.credentials.refreshToken,
    microsoftOAuthConfigFromEnv(),
  );

  // Muta o contexto para as chamadas seguintes da mesma execucao ja usarem o
  // token novo, sem esperar o round-trip de persistencia.
  ctx.credentials = renovadas;
  await ctx.onCredentialsRefreshed?.(renovadas);

  return renovadas.accessToken as string;
}

export async function fetchMicrosoftAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw mapMicrosoftError(response.status, response.headers.get('retry-after'));
  }
  const perfil = (await response.json()) as { mail?: string; userPrincipalName?: string };
  // Conta pessoal (Hotmail/Outlook.com) frequentemente vem com `mail` nulo;
  // userPrincipalName e o fallback confiavel nesse caso.
  const email = perfil.mail ?? perfil.userPrincipalName;
  if (!email) {
    throw new ConnectorError('PERMANENT', 'O Microsoft Graph nao devolveu o e-mail da conta');
  }
  return email;
}
