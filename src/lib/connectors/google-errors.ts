import { ConnectorError } from './types';

/**
 * Traducao dos erros do Google para o conjunto fechado do nucleo.
 *
 * Vive em modulo proprio porque tanto o conector quanto a camada de OAuth
 * precisam dele, e o conector importa a camada de OAuth.
 */

export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export function mapGoogleError(status: number, retryAfterHeader?: string | null): ConnectorError {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  switch (status) {
    case 401:
      return new ConnectorError('AUTH_EXPIRED', 'Token do Google expirado ou revogado');
    case 403:
      return new ConnectorError('RATE_LIMITED', 'Quota do Google excedida', retryAfter ?? 60);
    case 404:
      // O Gmail responde 404 quando o startHistoryId e antigo demais.
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
