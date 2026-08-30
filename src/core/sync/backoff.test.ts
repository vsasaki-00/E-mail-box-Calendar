import { describe, expect, it } from 'vitest';
import { backoffSeconds, decideAfterError, decideAfterSuccess } from './backoff';

const AGORA = new Date('2026-08-30T12:00:00Z');
const INTERVALO = 300;

function segundosAte(data: Date): number {
  return Math.round((data.getTime() - AGORA.getTime()) / 1000);
}

describe('backoffSeconds', () => {
  it('cresce exponencialmente', () => {
    expect(backoffSeconds(1, 0)).toBe(30);
    expect(backoffSeconds(2, 0)).toBe(60);
    expect(backoffSeconds(3, 0)).toBe(120);
  });

  it('respeita o teto de uma hora', () => {
    expect(backoffSeconds(20, 0)).toBe(3600);
  });

  it('aplica jitter para nao sincronizar todas as conexoes em fase', () => {
    expect(backoffSeconds(1, 1)).toBe(36);
  });
});

describe('decideAfterSuccess', () => {
  it('zera falhas e reagenda no intervalo normal', () => {
    const decisao = decideAfterSuccess(INTERVALO, AGORA);
    expect(decisao.failureCount).toBe(0);
    expect(decisao.status).toBe('IDLE');
    expect(decisao.connectionStatus).toBe('ACTIVE');
    expect(segundosAte(decisao.nextRunAt)).toBe(INTERVALO);
  });
});

describe('decideAfterError', () => {
  it('trata cursor expirado como fluxo normal, nao como falha', () => {
    // Gmail invalida historyId antigo e o Graph expira deltaLink: e esperado.
    const decisao = decideAfterError({
      code: 'CURSOR_EXPIRED',
      previousFailureCount: 0,
      pollIntervalSeconds: INTERVALO,
      now: AGORA,
    });

    expect(decisao.resetCursor).toBe(true);
    expect(decisao.failureCount).toBe(0);
    expect(decisao.connectionStatus).toBe('ACTIVE');
    expect(segundosAte(decisao.nextRunAt)).toBe(0);
  });

  it('marca reautenticacao e para de tentar em loop quando o token morre', () => {
    const decisao = decideAfterError({
      code: 'AUTH_EXPIRED',
      previousFailureCount: 0,
      pollIntervalSeconds: INTERVALO,
      now: AGORA,
    });

    expect(decisao.connectionStatus).toBe('REAUTH_REQUIRED');
    expect(decisao.status).toBe('FAILED');
    expect(segundosAte(decisao.nextRunAt)).toBeGreaterThan(INTERVALO);
  });

  it('respeita o Retry-After do provedor acima do proprio backoff', () => {
    // Ignorar esse header derruba a conexao por horas no Microsoft Graph.
    const decisao = decideAfterError({
      code: 'RATE_LIMITED',
      previousFailureCount: 0,
      pollIntervalSeconds: INTERVALO,
      retryAfterSeconds: 120,
      now: AGORA,
    });

    expect(segundosAte(decisao.nextRunAt)).toBe(120);
    expect(decisao.connectionStatus).toBe('DEGRADED');
  });

  it('nao trata item removido no provedor como erro', () => {
    const decisao = decideAfterError({
      code: 'NOT_FOUND',
      previousFailureCount: 2,
      pollIntervalSeconds: INTERVALO,
      now: AGORA,
    });

    expect(decisao.failureCount).toBe(0);
    expect(decisao.connectionStatus).toBe('ACTIVE');
  });

  it('degrada em falha transitoria e desiste apos o limite', () => {
    const primeira = decideAfterError({
      code: 'TRANSIENT',
      previousFailureCount: 0,
      pollIntervalSeconds: INTERVALO,
      now: AGORA,
      jitter: 0,
    });
    expect(primeira.status).toBe('BACKOFF');
    expect(primeira.connectionStatus).toBe('DEGRADED');

    const ultima = decideAfterError({
      code: 'TRANSIENT',
      previousFailureCount: 7,
      pollIntervalSeconds: INTERVALO,
      now: AGORA,
      jitter: 0,
    });
    expect(ultima.status).toBe('FAILED');
    expect(ultima.connectionStatus).toBe('ERROR');
  });

  it('marca erro permanente sem retentar agressivamente', () => {
    const decisao = decideAfterError({
      code: 'PERMANENT',
      previousFailureCount: 0,
      pollIntervalSeconds: INTERVALO,
      now: AGORA,
    });

    expect(decisao.status).toBe('FAILED');
    expect(decisao.connectionStatus).toBe('ERROR');
  });
});
