import { describe, expect, it } from 'vitest';
import {
  addDaysInZone,
  formatTime,
  isoDateInZone,
  isSameDayInZone,
  startOfDayInZone,
  zonedParts,
  zonedTimeToUtc,
  zonedWeekday,
  zoneOffsetMs,
} from './zone';

const SP = 'America/Sao_Paulo';
const LISBOA = 'Europe/Lisbon';

describe('zonedParts', () => {
  it('converte um instante UTC para a hora de parede em São Paulo', () => {
    // O bug que motivou este módulo: o servidor roda em UTC, e 10:00 UTC
    // NÃO são 10:00 em São Paulo.
    expect(zonedParts(new Date('2026-08-30T10:00:00Z'), SP)).toMatchObject({
      year: 2026,
      month: 8,
      day: 30,
      hour: 7,
    });
  });

  it('vira o dia para trás quando o horário UTC é de madrugada', () => {
    // 02:00 UTC de 30/08 são 23:00 de 29/08 em São Paulo. Sem isso, o
    // compromisso aparece no dia seguinte na agenda.
    expect(zonedParts(new Date('2026-08-30T02:00:00Z'), SP)).toMatchObject({
      day: 29,
      hour: 23,
    });
  });

  it('devolve 0, e não 24, para a meia-noite', () => {
    expect(zonedParts(new Date('2026-08-30T03:00:00Z'), SP).hour).toBe(0);
  });
});

describe('zoneOffsetMs', () => {
  it('São Paulo é UTC-3', () => {
    expect(zoneOffsetMs(new Date('2026-08-30T12:00:00Z'), SP)).toBe(-3 * 3_600_000);
  });

  it('UTC é zero', () => {
    expect(zoneOffsetMs(new Date('2026-08-30T12:00:00Z'), 'UTC')).toBe(0);
  });

  it('acompanha o horário de verão de um fuso que ainda o tem', () => {
    // Lisboa: UTC+0 no inverno, UTC+1 no verão. Se o offset fosse fixo, os
    // limites de dia sairiam errados metade do ano.
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), LISBOA)).toBe(0);
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), LISBOA)).toBe(3_600_000);
  });
});

describe('startOfDayInZone', () => {
  it('meia-noite em São Paulo é 03:00 UTC', () => {
    const inicio = startOfDayInZone(new Date('2026-08-30T18:00:00Z'), SP);
    expect(inicio.toISOString()).toBe('2026-08-30T03:00:00.000Z');
  });

  it('um instante de madrugada UTC pertence ao dia ANTERIOR em São Paulo', () => {
    const inicio = startOfDayInZone(new Date('2026-08-30T02:00:00Z'), SP);
    expect(inicio.toISOString()).toBe('2026-08-29T03:00:00.000Z');
  });

  it('é idempotente: o começo do dia começa nele mesmo', () => {
    const inicio = startOfDayInZone(new Date('2026-08-30T18:00:00Z'), SP);
    expect(startOfDayInZone(inicio, SP).toISOString()).toBe(inicio.toISOString());
  });
});

describe('zonedTimeToUtc', () => {
  it('converte hora de parede para o instante UTC certo', () => {
    expect(zonedTimeToUtc(SP, 2026, 8, 30, 14, 30).toISOString()).toBe('2026-08-30T17:30:00.000Z');
  });

  it('normaliza dia fora do mês (dia 32 vira o mês seguinte)', () => {
    expect(isoDateInZone(zonedTimeToUtc(SP, 2026, 8, 32), SP)).toBe('2026-09-01');
  });

  it('acerta mesmo atravessando a virada do horário de verão', () => {
    // Lisboa vira em 29/03/2026. A conversão em duas passadas existe por
    // isto: o offset do primeiro palpite pode ser o do outro lado da virada.
    expect(isoDateInZone(zonedTimeToUtc(LISBOA, 2026, 3, 29, 12, 0), LISBOA)).toBe('2026-03-29');
    expect(isoDateInZone(zonedTimeToUtc(LISBOA, 2026, 10, 25, 12, 0), LISBOA)).toBe('2026-10-25');
  });
});

describe('addDaysInZone', () => {
  it('anda dias mantendo a hora de parede', () => {
    const depois = addDaysInZone(new Date('2026-08-30T17:30:00Z'), SP, 3);
    expect(isoDateInZone(depois, SP)).toBe('2026-09-02');
    expect(formatTime(depois, SP)).toBe('14:30');
  });

  it('anda para trás', () => {
    expect(isoDateInZone(addDaysInZone(new Date('2026-09-02T12:00:00Z'), SP, -7), SP)).toBe(
      '2026-08-26',
    );
  });
});

describe('zonedWeekday', () => {
  it('responde no fuso pedido, não no do processo', () => {
    // 2026-08-30 é domingo. Às 02:00 UTC ainda é sábado em São Paulo.
    expect(zonedWeekday(new Date('2026-08-30T12:00:00Z'), SP)).toBe(0);
    expect(zonedWeekday(new Date('2026-08-30T02:00:00Z'), SP)).toBe(6);
  });
});

describe('isSameDayInZone', () => {
  it('dois instantes do mesmo dia local', () => {
    expect(
      isSameDayInZone(new Date('2026-08-30T12:00:00Z'), new Date('2026-08-31T02:00:00Z'), SP),
    ).toBe(true);
  });

  it('e de dias diferentes', () => {
    expect(
      isSameDayInZone(new Date('2026-08-30T12:00:00Z'), new Date('2026-08-31T12:00:00Z'), SP),
    ).toBe(false);
  });
});

describe('formatTime', () => {
  it('formata no fuso pedido, nunca no do servidor', () => {
    expect(formatTime(new Date('2026-08-30T10:00:00Z'), SP)).toBe('07:00');
    expect(formatTime(new Date('2026-08-30T10:00:00Z'), 'UTC')).toBe('10:00');
  });
});
