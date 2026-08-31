import { describe, expect, it } from 'vitest';
import {
  billAlerts,
  conflictAlerts,
  connectionAlerts,
  deriveAlerts,
  slaAlerts,
  type AlertConnectionState,
} from './rules';

const conexao = (over: Partial<AlertConnectionState> = {}): AlertConnectionState => ({
  id: 'c1',
  label: 'victor@brand.co',
  status: 'ACTIVE',
  isStale: false,
  minutesSinceSync: 4,
  lastErrorMessage: null,
  ...over,
});

describe('connectionAlerts', () => {
  it('conta saudavel nao gera alerta', () => {
    expect(connectionAlerts([conexao()])).toEqual([]);
  });

  it('reautenticacao e CRITICAL — so voce pode destravar', () => {
    const [alerta] = connectionAlerts([conexao({ status: 'REAUTH_REQUIRED', isStale: true })]);
    expect(alerta?.kind).toBe('REAUTH_NEEDED');
    expect(alerta?.severity).toBe('CRITICAL');
  });

  it('atraso e WARN — normalmente se resolve sozinho', () => {
    const [alerta] = connectionAlerts([conexao({ isStale: true, minutesSinceSync: 130 })]);
    expect(alerta?.kind).toBe('SYNC_STALE');
    expect(alerta?.severity).toBe('WARN');
    expect(alerta?.detail).toContain('2h');
  });

  it('NAO emite atraso junto com reautenticacao', () => {
    // Uma conta parada por reautenticacao tambem esta atrasada. Emitir os
    // dois seria dizer a mesma coisa duas vezes no mesmo painel.
    const alertas = connectionAlerts([conexao({ status: 'REAUTH_REQUIRED', isStale: true })]);
    expect(alertas).toHaveLength(1);
  });

  it('conta que nunca sincronizou e problema, nao estado neutro', () => {
    const [alerta] = connectionAlerts([conexao({ isStale: true, minutesSinceSync: null })]);
    expect(alerta?.detail).toContain('nunca sincronizou');
  });

  it('a chave identifica a CONDICAO, nao a ocorrencia', () => {
    // E o que impede a mesma conta atrasada de virar um alerta novo a cada
    // verificacao.
    const um = connectionAlerts([conexao({ isStale: true, minutesSinceSync: 100 })]);
    const dois = connectionAlerts([conexao({ isStale: true, minutesSinceSync: 900 })]);
    expect(um[0]?.dedupeKey).toBe(dois[0]?.dedupeKey);
  });
});

describe('conflictAlerts', () => {
  const base = {
    titleA: 'Consulta médica',
    titleB: 'Reunião de diretoria',
    startsAt: new Date('2026-09-01T14:00:00Z'),
  };

  it('so alerta conflito entre contas DIFERENTES', () => {
    // Sobreposicao dentro da mesma agenda voce ve abrindo ela; o valor
    // deste produto e o choque que nenhuma agenda sozinha mostra.
    expect(conflictAlerts([{ ...base, ids: ['a', 'b'], crossAccount: false }])).toEqual([]);
    expect(conflictAlerts([{ ...base, ids: ['a', 'b'], crossAccount: true }])).toHaveLength(1);
  });

  it('o mesmo par nao vira dois alertas conforme a ordem', () => {
    const um = conflictAlerts([{ ...base, ids: ['a', 'b'], crossAccount: true }]);
    const dois = conflictAlerts([{ ...base, ids: ['b', 'a'], crossAccount: true }]);
    expect(um[0]?.dedupeKey).toBe(dois[0]?.dedupeKey);
  });
});

describe('slaAlerts', () => {
  const base = { connectionId: 'c1', label: 'Brand.co', slaHours: 8 };

  it('nao alerta caixa em dia', () => {
    expect(slaAlerts([{ ...base, overdue: 0, oldestHours: 2 }])).toEqual([]);
  });

  it('vira CRITICAL ao passar do dobro do prazo', () => {
    expect(slaAlerts([{ ...base, overdue: 1, oldestHours: 9 }])[0]?.severity).toBe('WARN');
    expect(slaAlerts([{ ...base, overdue: 1, oldestHours: 17 }])[0]?.severity).toBe('CRITICAL');
  });

  it('a chave nao muda quando a contagem muda', () => {
    // A condicao e "esta caixa esta atrasada", e ela continua a mesma
    // quando o numero vai de 3 para 4.
    const tres = slaAlerts([{ ...base, overdue: 3, oldestHours: 10 }]);
    const quatro = slaAlerts([{ ...base, overdue: 4, oldestHours: 12 }]);
    expect(tres[0]?.dedupeKey).toBe(quatro[0]?.dedupeKey);
  });
});

describe('billAlerts', () => {
  const base = { unifiedItemId: 'i1', payee: 'Fornecedor S/A', amountCents: 15000 };

  it('ignora cobranca ainda longe do vencimento', () => {
    expect(billAlerts([{ ...base, daysUntilDue: 10 }])).toEqual([]);
  });

  it('avisa a partir de 3 dias e escala para CRITICAL quando vence', () => {
    expect(billAlerts([{ ...base, daysUntilDue: 3 }])[0]?.severity).toBe('WARN');
    expect(billAlerts([{ ...base, daysUntilDue: 0 }])[0]?.title).toContain('vence hoje');
    expect(billAlerts([{ ...base, daysUntilDue: -2 }])[0]?.severity).toBe('CRITICAL');
    expect(billAlerts([{ ...base, daysUntilDue: -2 }])[0]?.title).toContain('vencida há 2d');
  });

  it('repete a ressalva de completude tambem no alerta', () => {
    // O alerta pode ser o unico lugar que voce olha; a ressalva nao pode
    // ficar so na tela do painel.
    expect(billAlerts([{ ...base, daysUntilDue: 0 }])[0]?.detail).toContain('não é');
  });

  it('diz "valor não identificado" em vez de R$ 0,00', () => {
    expect(billAlerts([{ ...base, amountCents: null, daysUntilDue: 0 }])[0]?.detail).toContain(
      'valor não identificado',
    );
  });
});

describe('deriveAlerts', () => {
  it('ordena do mais grave para o menos', () => {
    const alertas = deriveAlerts({
      connections: [conexao({ isStale: true })],
      conflicts: [
        {
          ids: ['a', 'b'],
          titleA: 'x',
          titleB: 'y',
          crossAccount: true,
          startsAt: new Date(),
        },
      ],
      sla: [],
      bills: [],
    });

    expect(alertas[0]?.severity).toBe('CRITICAL');
    expect(alertas[1]?.severity).toBe('WARN');
  });

  it('estado limpo nao produz alerta nenhum', () => {
    expect(deriveAlerts({ connections: [conexao()], conflicts: [], sla: [], bills: [] })).toEqual([]);
  });

  it('todas as chaves sao unicas dentro de um ciclo', () => {
    const alertas = deriveAlerts({
      connections: [conexao({ id: 'c1', isStale: true }), conexao({ id: 'c2', isStale: true })],
      conflicts: [],
      sla: [{ connectionId: 'c1', label: 'a', slaHours: 8, overdue: 2, oldestHours: 10 }],
      bills: [{ unifiedItemId: 'i1', payee: 'x', amountCents: 1, daysUntilDue: 0 }],
    });
    const chaves = alertas.map((a) => a.dedupeKey);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
