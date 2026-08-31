import { describe, expect, it } from 'vitest';
import {
  budgetFromEnv,
  decideRun,
  DEFAULT_DAILY_BUDGET,
  remaining,
  startOfDay,
} from './budget';

describe('budgetFromEnv', () => {
  it('usa os padrões quando não há configuração', () => {
    expect(budgetFromEnv({})).toEqual(DEFAULT_DAILY_BUDGET);
  });

  it('lê os limites do ambiente', () => {
    expect(budgetFromEnv({ AUTO_TRIAGE_DAILY_LIMIT: '50', AUTO_BILLS_DAILY_LIMIT: '10' })).toEqual({
      maxTriage: 50,
      maxBills: 10,
    });
  });

  it('valor inválido cai no padrão em vez de virar NaN', () => {
    // NaN em comparação é sempre falso, então o teto sumiria em silêncio —
    // que é exatamente o modo de falha que um teto de gasto não pode ter.
    expect(budgetFromEnv({ AUTO_TRIAGE_DAILY_LIMIT: 'muito' }).maxTriage).toBe(
      DEFAULT_DAILY_BUDGET.maxTriage,
    );
    expect(budgetFromEnv({ AUTO_TRIAGE_DAILY_LIMIT: '-5' }).maxTriage).toBe(
      DEFAULT_DAILY_BUDGET.maxTriage,
    );
  });

  it('aceita zero como "desligado", que é diferente de inválido', () => {
    expect(budgetFromEnv({ AUTO_TRIAGE_DAILY_LIMIT: '0' }).maxTriage).toBe(0);
  });
});

describe('remaining', () => {
  it('nunca devolve negativo', () => {
    expect(remaining(120, 100)).toBe(0);
    expect(remaining(30, 100)).toBe(70);
  });
});

describe('decideRun', () => {
  const base = {
    enabled: true,
    hasApiKey: true,
    pending: 50,
    usedToday: 0,
    dailyLimit: 1000,
    perCycleLimit: 200,
  };

  it('roda quando tudo está no lugar', () => {
    expect(decideRun(base)).toEqual({ run: true, limit: 50 });
  });

  it('não roda desligado, sem chave, ou sem nada pendente', () => {
    expect(decideRun({ ...base, enabled: false }).reason).toBe('DESLIGADO');
    expect(decideRun({ ...base, hasApiKey: false }).reason).toBe('SEM_CHAVE_DE_API');
    expect(decideRun({ ...base, pending: 0 }).reason).toBe('NADA_PENDENTE');
  });

  it('para ao estourar o orçamento do dia', () => {
    expect(decideRun({ ...base, usedToday: 1000 }).reason).toBe('ORCAMENTO_ESGOTADO');
    expect(decideRun({ ...base, usedToday: 1200 }).reason).toBe('ORCAMENTO_ESGOTADO');
  });

  it('limita pela sobra do dia quando ela é menor', () => {
    expect(decideRun({ ...base, usedToday: 980, pending: 500 })).toEqual({ run: true, limit: 20 });
  });

  it('limita por ciclo para não gastar o dia inteiro de uma vez', () => {
    // Sem isso, o primeiro sync de uma caixa antiga queimaria o orçamento
    // do dia inteiro num único ciclo.
    expect(decideRun({ ...base, pending: 5000 })).toEqual({ run: true, limit: 200 });
  });

  it('nunca processa mais do que existe pendente', () => {
    expect(decideRun({ ...base, pending: 3 }).limit).toBe(3);
  });

  it('teto zero desliga na prática', () => {
    expect(decideRun({ ...base, dailyLimit: 0 }).reason).toBe('ORCAMENTO_ESGOTADO');
  });
});

describe('startOfDay', () => {
  it('zera a hora, no fuso local de quem paga a conta', () => {
    const inicio = startOfDay(new Date('2026-08-31T18:42:13'));
    expect(inicio.getHours()).toBe(0);
    expect(inicio.getMinutes()).toBe(0);
    expect(inicio.getDate()).toBe(31);
  });
});
