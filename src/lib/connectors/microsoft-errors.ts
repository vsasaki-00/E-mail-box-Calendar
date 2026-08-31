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

/**
 * Extrai o motivo que o Graph mandou no corpo.
 *
 * O Graph responde `{"error":{"code":"...","message":"..."}}` e e ali que
 * mora a informacao util — "Erro 400 no Graph" sozinho nao permite
 * diagnostico nenhum, como se provou no primeiro sync real de uma caixa
 * Outlook. O corpo do erro descreve a CHAMADA, nao o conteudo da caixa,
 * entao mostra-lo nao vaza e-mail. Ver docs/04-seguranca.md
 */
export function detalheDoGraph(corpo: string | undefined): string | undefined {
  if (!corpo) return undefined;
  try {
    const json = JSON.parse(corpo) as { error?: { code?: string; message?: string } };
    const codigo = json.error?.code;
    const mensagem = json.error?.message;
    if (!codigo && !mensagem) return undefined;
    const texto = [codigo, mensagem].filter(Boolean).join(': ');
    // Mensagem do Graph pode ser longa; o suficiente para diagnosticar.
    return texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;
  } catch {
    // Nem todo erro vem em JSON (proxy, gateway). Texto cru serve.
    const limpo = corpo.trim();
    if (!limpo || limpo.startsWith('<')) return undefined;
    return limpo.length > 300 ? `${limpo.slice(0, 300)}…` : limpo;
  }
}

export function mapMicrosoftError(
  status: number,
  retryAfterHeader?: string | null,
  corpo?: string,
): ConnectorError {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  const detalhe = detalheDoGraph(corpo);
  const com = (base: string) => (detalhe ? `${base} — ${detalhe}` : base);

  switch (status) {
    case 401:
      return new ConnectorError('AUTH_EXPIRED', com('Token do Microsoft Graph expirado ou revogado'));
    case 403:
      return new ConnectorError('PERMANENT', com('Permissao insuficiente no Microsoft Graph'));
    case 404:
      return new ConnectorError('NOT_FOUND', com('Recurso nao encontrado no Graph'));
    case 410:
      // resyncRequired: o deltaLink saiu da janela de retencao do Graph.
      return new ConnectorError('CURSOR_EXPIRED', com('deltaLink expirado; requer full sync'));
    case 429:
      return new ConnectorError('RATE_LIMITED', com('Throttling do Graph'), retryAfter ?? 30);
    default:
      if (status >= 500) {
        return new ConnectorError('TRANSIENT', com(`Erro ${status} no Graph`), retryAfter ?? 10);
      }
      return new ConnectorError('PERMANENT', com(`Erro ${status} no Graph`));
  }
}
