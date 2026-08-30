import { ConnectorError } from './types';

/**
 * Traducao dos erros do Microsoft Graph para o conjunto fechado do nucleo.
 *
 * Vive em modulo proprio porque tanto o conector quanto a camada de OAuth
 * precisam dele, e o conector importa a camada de OAuth.
 *
 * O Graph faz throttling agressivo com 429 + Retry-After. Ignorar esse header
 * derruba a conexao inteira por horas, entao ele e sempre respeitado.
 */

export const MICROSOFT_TOKEN_ENDPOINT_BASE = 'https://login.microsoftonline.com';

export function mapMicrosoftError(
  status: number,
  retryAfterHeader?: string | null,
): ConnectorError {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  switch (status) {
    case 401:
      return new ConnectorError('AUTH_EXPIRED', 'Token do Microsoft Graph expirado ou revogado');
    case 403:
      return new ConnectorError('PERMANENT', 'Permissao insuficiente no Microsoft Graph');
    case 404:
      return new ConnectorError('NOT_FOUND', 'Recurso nao encontrado no Graph');
    case 410:
      // resyncRequired: o deltaLink saiu da janela de retencao do Graph.
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
