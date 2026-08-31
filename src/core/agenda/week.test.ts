import { describe, expect, it } from 'vitest';
import { buildWeek, shiftWeeks, summarizeWeek, weekBounds } from './week';
import type { ConflictCandidate } from '@/core/metrics/conflicts';

const CORES = new Map([
  ['c1', '#111'],
  ['c2', '#222'],
]);

function evento(over: Partial<ConflictCandidate> & { id: string; startsAt: Date; endsAt: Date }): ConflictCandidate {
  return {
    connectionId: 'c1',
    connectionLabel: 'Pessoal',
    title: 'Reunião',
    isAllDay: false,
    status: 'CONFIRMED',
    ...over,
  };
}

// Quarta-feira, 2 de setembro de 2026.
const QUARTA = new Date('2026-09-02T12:00:00');

describe('weekBounds — semana começa na segunda', () => {
  it('volta para a segunda da semana corrente', () => {
    const { start, end } = weekBounds(QUARTA);
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(31); // 31/08/2026 é segunda
    expect(end.getDate()).toBe(7); // domingo 06 + 1
  });

  it('domingo pertence à semana que começou na segunda anterior', () => {
    // O erro classico: getDay() do domingo e 0, e a semana pularia.
    const domingo = new Date('2026-09-06T12:00:00');
    expect(weekBounds(domingo).start.getDate()).toBe(31);
  });

  it('segunda é o próprio começo', () => {
    const segunda = new Date('2026-08-31T09:00:00');
    expect(weekBounds(segunda).start.getDate()).toBe(31);
  });

  it('começa à meia-noite', () => {
    expect(weekBounds(QUARTA).start.getHours()).toBe(0);
  });
});

describe('shiftWeeks', () => {
  it('anda para frente e para trás em semanas inteiras', () => {
    expect(weekBounds(shiftWeeks(QUARTA, 1)).start.getDate()).toBe(7);
    expect(weekBounds(shiftWeeks(QUARTA, -1)).start.getDate()).toBe(24);
  });
});

describe('buildWeek', () => {
  const inicio = weekBounds(QUARTA).start;

  it('devolve sempre sete dias, inclusive os vazios', () => {
    // Uma semana com buraco no meio nao pode parecer uma semana de 5 dias.
    const dias = buildWeek([], CORES, inicio, { now: QUARTA });
    expect(dias).toHaveLength(7);
    expect(dias.every((d) => d.entries.length === 0)).toBe(true);
  });

  it('colapsa o mesmo compromisso visto de duas contas em UMA linha', () => {
    // O problema que o produto existe para resolver.
    const dias = buildWeek(
      [
        evento({
          id: 'a',
          connectionId: 'c1',
          connectionLabel: 'Pessoal',
          dedupeKey: 'evt:ical:x:1',
          startsAt: new Date('2026-09-02T14:00:00'),
          endsAt: new Date('2026-09-02T15:00:00'),
        }),
        evento({
          id: 'b',
          connectionId: 'c2',
          connectionLabel: 'Trabalho',
          dedupeKey: 'evt:ical:x:1',
          startsAt: new Date('2026-09-02T14:00:00'),
          endsAt: new Date('2026-09-02T15:00:00'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA },
    );

    const quarta = dias[2];
    expect(quarta?.entries).toHaveLength(1);
    expect(quarta?.entries[0]?.accounts).toHaveLength(2);
    // E nao vira conflito consigo mesmo.
    expect(quarta?.conflicts).toHaveLength(0);
  });

  it('evento de vários dias aparece em TODOS os dias que cobre', () => {
    // Mostrar so no dia de inicio faria a quarta parecer livre.
    const dias = buildWeek(
      [
        evento({
          id: 'viagem',
          title: 'Viagem São Paulo',
          startsAt: new Date('2026-09-01T08:00:00'),
          endsAt: new Date('2026-09-03T20:00:00'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA },
    );

    expect(dias[1]?.entries).toHaveLength(1); // terça
    expect(dias[2]?.entries).toHaveLength(1); // quarta
    expect(dias[3]?.entries).toHaveLength(1); // quinta
    expect(dias[4]?.entries).toHaveLength(0); // sexta
  });

  it('separa dia inteiro dos compromissos com horário', () => {
    const dias = buildWeek(
      [
        evento({
          id: 'feriado',
          isAllDay: true,
          startsAt: new Date('2026-09-02T00:00:00'),
          endsAt: new Date('2026-09-03T00:00:00'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA },
    );

    expect(dias[2]?.allDay).toHaveLength(1);
    expect(dias[2]?.entries).toHaveLength(0);
  });

  it('detecta conflito entre contas diferentes no dia', () => {
    const dias = buildWeek(
      [
        evento({
          id: 'a',
          connectionId: 'c1',
          dedupeKey: 'evt:a',
          startsAt: new Date('2026-09-02T14:00:00'),
          endsAt: new Date('2026-09-02T15:00:00'),
        }),
        evento({
          id: 'b',
          connectionId: 'c2',
          connectionLabel: 'Trabalho',
          dedupeKey: 'evt:b',
          startsAt: new Date('2026-09-02T14:30:00'),
          endsAt: new Date('2026-09-02T15:30:00'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA },
    );

    expect(dias[2]?.conflicts).toHaveLength(1);
    expect(dias[2]?.conflicts[0]?.crossAccount).toBe(true);
  });

  it('marca o dia de hoje', () => {
    const dias = buildWeek([], CORES, inicio, { now: QUARTA });
    expect(dias.filter((d) => d.isToday)).toHaveLength(1);
    expect(dias[2]?.isToday).toBe(true);
  });

  it('NAO marca "hoje" numa semana que nao contem hoje', () => {
    // Bug encontrado navegando na tela: a semana a mostrar e a data de
    // referencia; "hoje" e o instante real. Confundir os dois marcava o dia
    // equivalente da semana passada como hoje.
    const semanaPassada = weekBounds(new Date('2026-08-26T12:00:00')).start;
    const dias = buildWeek([], CORES, semanaPassada, { now: QUARTA });
    expect(dias.filter((d) => d.isToday)).toHaveLength(0);
  });

  it('acha as janelas livres do expediente', () => {
    const dias = buildWeek(
      [
        evento({
          id: 'a',
          startsAt: new Date('2026-09-02T09:00:00'),
          endsAt: new Date('2026-09-02T12:00:00'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA },
    );
    // Sobra 12h–18h.
    expect(dias[2]?.freeWindows[0]?.minutes).toBe(360);
  });
});

describe('summarizeWeek', () => {
  const inicio = weekBounds(QUARTA).start;

  it('conta quantas cópias a unificação poupou', () => {
    // E a prova de que a unificacao esta servindo para alguma coisa.
    const eventos = [
      evento({
        id: 'a',
        connectionId: 'c1',
        dedupeKey: 'evt:x',
        startsAt: new Date('2026-09-02T14:00:00'),
        endsAt: new Date('2026-09-02T15:00:00'),
      }),
      evento({
        id: 'b',
        connectionId: 'c2',
        dedupeKey: 'evt:x',
        startsAt: new Date('2026-09-02T14:00:00'),
        endsAt: new Date('2026-09-02T15:00:00'),
      }),
    ];
    const resumo = summarizeWeek(buildWeek(eventos, CORES, inicio, { now: QUARTA }), eventos);

    expect(resumo.total).toBe(1);
    expect(resumo.collapsed).toBe(1);
    expect(resumo.crossAccountConflicts).toBe(0);
  });

  it('não conta o mesmo conflito duas vezes', () => {
    const eventos = [
      evento({
        id: 'a',
        connectionId: 'c1',
        dedupeKey: 'evt:a',
        startsAt: new Date('2026-09-02T14:00:00'),
        endsAt: new Date('2026-09-02T15:00:00'),
      }),
      evento({
        id: 'b',
        connectionId: 'c2',
        dedupeKey: 'evt:b',
        startsAt: new Date('2026-09-02T14:30:00'),
        endsAt: new Date('2026-09-02T15:30:00'),
      }),
    ];
    expect(summarizeWeek(buildWeek(eventos, CORES, inicio, { now: QUARTA }), eventos)
      .crossAccountConflicts).toBe(1);
  });

  it('semana vazia devolve zeros, sem inventar', () => {
    const resumo = summarizeWeek(buildWeek([], CORES, inicio, { now: QUARTA }), []);
    expect(resumo).toMatchObject({ total: 0, crossAccountConflicts: 0, collapsed: 0 });
  });
});
