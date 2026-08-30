import type { ConnectorErrorCode } from '@/lib/connectors/types';

/**
 * Politica de retentativa e agendamento do motor de sync.
 * Logica pura, sem banco, para poder ser testada isoladamente.
 */

export interface RetryDecision {
  /** Quando rodar de novo. */
  nextRunAt: Date;
  /** Descartar o cursor e fazer full sync na proxima execucao. */
  resetCursor: boolean;
  /** Novo status a gravar em SyncState. */
  status: 'IDLE' | 'BACKOFF' | 'CURSOR_EXPIRED' | 'FAILED';
  /** Status a propagar para a Connection, quando muda. */
  connectionStatus?: 'ACTIVE' | 'DEGRADED' | 'REAUTH_REQUIRED' | 'ERROR';
  /** Falhas consecutivas apos esta decisao. */
  failureCount: number;
}

const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 3_600;
/** Acima disso a conexao para de tentar e vira alerta para o usuario agir. */
export const MAX_CONSECUTIVE_FAILURES = 8;

/** Backoff exponencial com teto e jitter, para nao sincronizar tudo em fase. */
export function backoffSeconds(failureCount: number, jitter = Math.random()): number {
  const exponential = BASE_BACKOFF_SECONDS * 2 ** Math.max(0, failureCount - 1);
  const capped = Math.min(exponential, MAX_BACKOFF_SECONDS);
  // Jitter de ate 20% para cima, evitando que N conexoes retentem juntas.
  return Math.round(capped * (1 + jitter * 0.2));
}

/** Execucao bem-sucedida: zera o contador e volta ao intervalo normal. */
export function decideAfterSuccess(pollIntervalSeconds: number, now = new Date()): RetryDecision {
  return {
    nextRunAt: new Date(now.getTime() + pollIntervalSeconds * 1_000),
    resetCursor: false,
    status: 'IDLE',
    connectionStatus: 'ACTIVE',
    failureCount: 0,
  };
}

/**
 * Traduz o erro do conector em uma decisao de agendamento.
 * Cada codigo tem uma reacao unica; ver a tabela em docs/03-conectores.md.
 */
export function decideAfterError(params: {
  code: ConnectorErrorCode;
  previousFailureCount: number;
  pollIntervalSeconds: number;
  retryAfterSeconds?: number;
  now?: Date;
  jitter?: number;
}): RetryDecision {
  const now = params.now ?? new Date();
  const failureCount = params.previousFailureCount + 1;
  const delay = (seconds: number) => new Date(now.getTime() + seconds * 1_000);

  switch (params.code) {
    case 'CURSOR_EXPIRED':
      // Nao e falha: o provedor invalidou o cursor. Refaz full sync ja.
      return {
        nextRunAt: now,
        resetCursor: true,
        status: 'CURSOR_EXPIRED',
        connectionStatus: 'ACTIVE',
        failureCount: 0,
      };

    case 'AUTH_EXPIRED':
      // O refresh ja foi tentado pelo conector; chegar aqui significa que o
      // usuario precisa reautorizar. Nao adianta retentar em loop.
      return {
        nextRunAt: delay(params.pollIntervalSeconds * 12),
        resetCursor: false,
        status: 'FAILED',
        connectionStatus: 'REAUTH_REQUIRED',
        failureCount,
      };

    case 'RATE_LIMITED':
      // Retry-After do provedor tem prioridade sobre nosso backoff.
      return {
        nextRunAt: delay(params.retryAfterSeconds ?? backoffSeconds(failureCount, params.jitter)),
        resetCursor: false,
        status: 'BACKOFF',
        connectionStatus: 'DEGRADED',
        failureCount,
      };

    case 'NOT_FOUND':
      // O item sumiu no provedor. Nao e erro de sync.
      return {
        nextRunAt: delay(params.pollIntervalSeconds),
        resetCursor: false,
        status: 'IDLE',
        connectionStatus: 'ACTIVE',
        failureCount: 0,
      };

    case 'TRANSIENT': {
      const desistiu = failureCount >= MAX_CONSECUTIVE_FAILURES;
      return {
        nextRunAt: delay(
          params.retryAfterSeconds ?? backoffSeconds(failureCount, params.jitter),
        ),
        resetCursor: false,
        status: desistiu ? 'FAILED' : 'BACKOFF',
        connectionStatus: desistiu ? 'ERROR' : 'DEGRADED',
        failureCount,
      };
    }

    case 'PERMANENT':
    default:
      return {
        nextRunAt: delay(params.pollIntervalSeconds * 12),
        resetCursor: false,
        status: 'FAILED',
        connectionStatus: 'ERROR',
        failureCount,
      };
  }
}
