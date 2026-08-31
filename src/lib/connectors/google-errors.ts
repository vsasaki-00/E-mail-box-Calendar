import { ConnectorError } from './types';

/**
 * Traducao dos erros do Google para o conjunto fechado do nucleo.
 *
 * Vive em modulo proprio porque tanto o conector quanto a camada de OAuth
 * precisam dele, e o conector importa a camada de OAuth.
 */

export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Extrai o motivo do corpo de erro do Google (`{"error":{"message":...}}`).
 * Mesma razao do lado Microsoft: "Erro 400" sozinho nao diagnostica nada.
 * O corpo descreve a CHAMADA, nunca o conteudo da caixa.
 */
export function detalheDoGoogle(corpo: string | undefined): string | undefined {
  if (!corpo) return undefined;
  try {
    const json = JSON.parse(corpo) as {
      error?: { message?: string; status?: string; errors?: { reason?: string }[] };
    };
    const razao = json.error?.status ?? json.error?.errors?.[0]?.reason;
    const texto = [razao, json.error?.message].filter(Boolean).join(': ');
    if (!texto) return undefined;
    return texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;
  } catch {
    const limpo = corpo.trim();
    if (!limpo || limpo.startsWith('<')) return undefined;
    return limpo.length > 300 ? `${limpo.slice(0, 300)}…` : limpo;
  }
}

export function mapGoogleError(
  status: number,
  retryAfterHeader?: string | null,
  corpo?: string,
): ConnectorError {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  const detalhe = detalheDoGoogle(corpo);
  const com = (base: string) => (detalhe ? `${base} — ${detalhe}` : base);

  switch (status) {
    case 401:
      return new ConnectorError('AUTH_EXPIRED', com('Token do Google expirado ou revogado'));
    case 403:
      return new ConnectorError('RATE_LIMITED', com('Quota do Google excedida'), retryAfter ?? 60);
    case 404:
      // O Gmail responde 404 quando o startHistoryId e antigo demais.
      return new ConnectorError('NOT_FOUND', com('Recurso nao encontrado no Google'));
    case 410:
      return new ConnectorError('CURSOR_EXPIRED', com('syncToken/historyId invalido; requer full sync'));
    case 429:
      return new ConnectorError('RATE_LIMITED', com('Rate limit do Google'), retryAfter ?? 30);
    default:
      if (status >= 500) {
        return new ConnectorError('TRANSIENT', com(`Erro ${status} no Google`), retryAfter ?? 10);
      }
      return new ConnectorError('PERMANENT', com(`Erro ${status} no Google`));
  }
}
