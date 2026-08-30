import { ConnectorError } from './types';

/**
 * Traducao dos erros de IMAP e CalDAV para o conjunto fechado do nucleo.
 *
 * Diferente do Google/Microsoft, nem imapflow nem tsdav padronizam um codigo
 * de erro por instancia (sem `.status` HTTP em todo erro IMAP, sem `.code`
 * estavel em todo erro do tsdav) — ambas as bibliotecas comunicam a causa via
 * `.message` de texto livre. Por isso o mapeamento aqui e por reconhecimento
 * de padrao na mensagem, verificado contra o codigo-fonte de cada biblioteca
 * (node_modules/imapflow, node_modules/tsdav) nesta sessao.
 */

/** Códigos de erro de rede do Node (net/tls) que valem retry. */
const TRANSIENT_NODE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'CONNECT_TIMEOUT',
]);

interface NodeErrorLike {
  code?: string;
  message?: string;
  authenticationFailed?: boolean;
}

/**
 * Erros do imapflow. `AuthenticationFailure` tem `authenticationFailed: true`
 * — verificado em node_modules/imapflow/lib/imap-flow.d.ts. Erros de rede vêm
 * do Node puro (net/tls) e carregam `.code`.
 */
export function mapImapError(error: unknown): ConnectorError {
  const err = error as NodeErrorLike;

  if (err?.authenticationFailed) {
    return new ConnectorError('AUTH_EXPIRED', 'Login IMAP recusado: usuário ou senha inválidos');
  }
  if (err?.code === 'LineTooLarge' || err?.code === 'LiteralTooLarge' || err?.code === 'ResponseTooLarge') {
    return new ConnectorError('PERMANENT', `Servidor IMAP enviou uma resposta fora do limite (${err.code})`);
  }
  if (err?.code && TRANSIENT_NODE_CODES.has(err.code)) {
    return new ConnectorError('TRANSIENT', `Falha de rede IMAP (${err.code}): ${err.message ?? ''}`);
  }

  return new ConnectorError('PERMANENT', err?.message ?? 'Erro desconhecido de IMAP');
}

/**
 * Erros do tsdav são `Error` genérico com mensagem de texto — verificado em
 * node_modules/tsdav/dist/tsdav.cjs.js. `fetchPrincipalUrl` lança
 * literalmente "Invalid credentials: PROPFIND ... 401 Unauthorized" para
 * login recusado; RFC 6578 define 410 Gone para sync-token invalidado.
 */
export function mapCaldavError(error: unknown): ConnectorError {
  const err = error as NodeErrorLike;
  const message = err?.message ?? String(error);

  if (/401 Unauthorized|Invalid credentials/i.test(message)) {
    return new ConnectorError('AUTH_EXPIRED', 'Login CalDAV recusado: usuário ou senha inválidos');
  }
  if (/\b403\b/.test(message)) {
    return new ConnectorError('PERMANENT', `Permissão CalDAV insuficiente: ${message}`);
  }
  if (/\b404\b/.test(message) || /cannot find (principalUrl|homeUrl)/i.test(message)) {
    return new ConnectorError('NOT_FOUND', `Recurso CalDAV não encontrado: ${message}`);
  }
  if (/\b410\b/.test(message)) {
    return new ConnectorError('CURSOR_EXPIRED', 'syncToken do CalDAV invalidado pelo servidor (RFC 6578); requer full sync');
  }
  if (/\b429\b/.test(message)) {
    return new ConnectorError('RATE_LIMITED', `Rate limit do CalDAV: ${message}`, 30);
  }
  if (err?.code && TRANSIENT_NODE_CODES.has(err.code)) {
    return new ConnectorError('TRANSIENT', `Falha de rede CalDAV (${err.code}): ${message}`);
  }

  return new ConnectorError('PERMANENT', message);
}
