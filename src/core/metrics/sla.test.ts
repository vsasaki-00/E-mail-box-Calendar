import { describe, expect, it } from 'vitest';
import {
  BUSINESS_SLA_HOURS,
  computeSla,
  effectiveSlaHours,
  hoursWaiting,
  mostOverdue,
  slaHoursFor,
  type AwaitingReply,
} from './sla';

const AGORA = new Date('2026-08-31T18:00:00Z');

const esperando = (over: Partial<AwaitingReply> & { unifiedItemId: string }): AwaitingReply => ({
  connectionId: 'c1',
  receivedAt: new Date('2026-08-31T10:00:00Z'),
  priority: 'NORMAL',
  title: 'assunto',
  fromLabel: 'cliente@x.com',
  ...over,
});

describe('slaHoursFor — prazo por contexto de negocio', () => {
  it('caixa de negocio nasce com prazo curto', () => {
    // Mesma logica assimetrica da calibragem da triagem: demorar com um
    // cliente custa caro, demorar com newsletter nao custa nada.
    expect(slaHoursFor('Brand.co')).toBe(BUSINESS_SLA_HOURS);
    expect(slaHoursFor('Unitedcom')).toBe(BUSINESS_SLA_HOURS);
  });

  it('Pessoais e Outros nascem com prazo longo', () => {
    expect(slaHoursFor('Pessoais')).toBe(72);
    expect(slaHoursFor('Outros')).toBe(48);
  });

  it('caixa sem negocio definido usa o prazo de negocio', () => {
    // Na duvida, o prazo curto: alertar a mais e recuperavel.
    expect(slaHoursFor(null)).toBe(BUSINESS_SLA_HOURS);
  });
});

describe('effectiveSlaHours', () => {
  it('urgente encurta o prazo pela metade', () => {
    expect(effectiveSlaHours(8, 'URGENT')).toBe(4);
    expect(effectiveSlaHours(8, 'NORMAL')).toBe(8);
  });

  it('nunca desce abaixo de 1h', () => {
    expect(effectiveSlaHours(1, 'URGENT')).toBe(1);
  });
});

describe('hoursWaiting', () => {
  it('conta horas inteiras desde a chegada', () => {
    expect(hoursWaiting(new Date('2026-08-31T10:00:00Z'), AGORA)).toBe(8);
  });

  it('nunca devolve negativo para mensagem do futuro', () => {
    // Relogio de provedor adiantado acontece.
    expect(hoursWaiting(new Date('2026-09-01T10:00:00Z'), AGORA)).toBe(0);
  });
});

describe('computeSla', () => {
  const caixas = [
    { connectionId: 'c1', label: 'Brand.co', businessName: 'Brand.co' },
    { connectionId: 'c2', label: 'Pessoal', businessName: 'Pessoais' },
  ];

  it('conta quem espera e quem passou do prazo, por caixa', () => {
    const resultado = computeSla(
      [
        esperando({ unifiedItemId: 'a' }), // 8h numa caixa de 8h -> vencido
        esperando({ unifiedItemId: 'b', receivedAt: new Date('2026-08-31T16:00:00Z') }), // 2h
        esperando({ unifiedItemId: 'c', connectionId: 'c2' }), // 8h numa caixa de 72h
      ],
      caixas,
      AGORA,
    );

    expect(resultado[0]).toMatchObject({ waiting: 2, overdue: 1, oldestHours: 8 });
    expect(resultado[1]).toMatchObject({ waiting: 1, overdue: 0, oldestHours: 8 });
  });

  it('o MESMO atraso vence numa caixa e nao vence na outra', () => {
    // E o ponto inteiro de ter prazo por negocio.
    const resultado = computeSla(
      [esperando({ unifiedItemId: 'a' }), esperando({ unifiedItemId: 'b', connectionId: 'c2' })],
      caixas,
      AGORA,
    );
    expect(resultado[0]?.overdue).toBe(1);
    expect(resultado[1]?.overdue).toBe(0);
  });

  it('urgente vence antes na mesma caixa', () => {
    const resultado = computeSla(
      [esperando({ unifiedItemId: 'a', receivedAt: new Date('2026-08-31T13:00:00Z'), priority: 'URGENT' })],
      caixas,
      AGORA,
    );
    // 5h esperando, prazo urgente de 4h.
    expect(resultado[0]?.overdue).toBe(1);
  });

  it('caixa sem ninguem esperando aparece com zero, nao some', () => {
    // Sumir faria a lista parecer menor do que o conjunto de caixas que
    // voce tem, e a Torre existe para responder sobre TODAS.
    const resultado = computeSla([], caixas, AGORA);
    expect(resultado).toHaveLength(2);
    expect(resultado[0]).toMatchObject({ waiting: 0, overdue: 0, oldestHours: null });
  });
});

describe('mostOverdue', () => {
  const caixas = [
    { connectionId: 'c1', label: 'Brand.co', businessName: 'Brand.co' },
    { connectionId: 'c2', label: 'Pessoal', businessName: 'Pessoais' },
  ];

  it('vencidos primeiro, e entre eles o que espera ha mais tempo', () => {
    const lista = mostOverdue(
      [
        esperando({ unifiedItemId: 'recente', receivedAt: new Date('2026-08-31T17:00:00Z') }),
        esperando({ unifiedItemId: 'pessoal-antigo', connectionId: 'c2', receivedAt: new Date('2026-08-30T10:00:00Z') }),
        esperando({ unifiedItemId: 'vencido', receivedAt: new Date('2026-08-31T06:00:00Z') }),
      ],
      caixas,
      5,
      AGORA,
    );

    // O pessoal de 32h NAO esta vencido (prazo 72h); o de negocio de 12h esta.
    expect(lista[0]?.unifiedItemId).toBe('vencido');
    expect(lista[0]?.overdue).toBe(true);
    expect(lista.find((i) => i.unifiedItemId === 'pessoal-antigo')?.overdue).toBe(false);
  });

  it('respeita o limite', () => {
    const muitos = Array.from({ length: 20 }, (_, i) => esperando({ unifiedItemId: `i${i}` }));
    expect(mostOverdue(muitos, caixas, 5, AGORA)).toHaveLength(5);
  });
});
