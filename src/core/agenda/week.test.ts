import { describe, expect, it } from 'vitest';
import {
  buildMonth,
  buildWeek,
  monthGridBounds,
  shiftMonths,
  shiftWeeks,
  summarizeWeek,
  weekBounds,
} from './week';
import { isoDateInZone } from '@/core/time/zone';
import type { ConflictCandidate } from '@/core/metrics/conflicts';

const SP = 'America/Sao_Paulo';

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
//
// Os testes estruturais rodam com `timeZone: 'UTC'` para a hora de parede
// bater com o texto das datas. O bloco no fim cobre especificamente o fuso
// de Sao Paulo, que e onde estava o bug.
const QUARTA = new Date('2026-09-02T12:00:00Z');
const UTC = { timeZone: 'UTC' } as const;

describe('weekBounds — semana começa na segunda', () => {
  it('volta para a segunda da semana corrente', () => {
    const { start, end } = weekBounds(QUARTA, 'UTC');
    expect(start.getUTCDay()).toBe(1);
    expect(start.getUTCDate()).toBe(31); // 31/08/2026 é segunda
    expect(end.getUTCDate()).toBe(7); // domingo 06 + 1
  });

  it('domingo pertence à semana que começou na segunda anterior', () => {
    // O erro classico: getDay() do domingo e 0, e a semana pularia.
    const domingo = new Date('2026-09-06T12:00:00Z');
    expect(weekBounds(domingo, 'UTC').start.getUTCDate()).toBe(31);
  });

  it('segunda é o próprio começo', () => {
    const segunda = new Date('2026-08-31T09:00:00Z');
    expect(weekBounds(segunda, 'UTC').start.getUTCDate()).toBe(31);
  });

  it('começa à meia-noite do fuso pedido', () => {
    expect(weekBounds(QUARTA, 'UTC').start.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    // Em Sao Paulo, meia-noite local e 03:00 UTC.
    expect(weekBounds(QUARTA, SP).start.toISOString()).toBe('2026-08-31T03:00:00.000Z');
  });
});

describe('shiftWeeks', () => {
  it('anda para frente e para trás em semanas inteiras', () => {
    expect(weekBounds(shiftWeeks(QUARTA, 1, 'UTC'), 'UTC').start.getUTCDate()).toBe(7);
    expect(weekBounds(shiftWeeks(QUARTA, -1, 'UTC'), 'UTC').start.getUTCDate()).toBe(24);
  });
});

describe('buildWeek', () => {
  const inicio = weekBounds(QUARTA, 'UTC').start;

  it('devolve sempre sete dias, inclusive os vazios', () => {
    // Uma semana com buraco no meio nao pode parecer uma semana de 5 dias.
    const dias = buildWeek([], CORES, inicio, { now: QUARTA, ...UTC });
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
          startsAt: new Date('2026-09-02T14:00:00Z'),
          endsAt: new Date('2026-09-02T15:00:00Z'),
        }),
        evento({
          id: 'b',
          connectionId: 'c2',
          connectionLabel: 'Trabalho',
          dedupeKey: 'evt:ical:x:1',
          startsAt: new Date('2026-09-02T14:00:00Z'),
          endsAt: new Date('2026-09-02T15:00:00Z'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA, ...UTC },
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
          startsAt: new Date('2026-09-01T08:00:00Z'),
          endsAt: new Date('2026-09-03T20:00:00Z'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA, ...UTC },
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
          startsAt: new Date('2026-09-02T00:00:00Z'),
          endsAt: new Date('2026-09-03T00:00:00Z'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA, ...UTC },
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
          startsAt: new Date('2026-09-02T14:00:00Z'),
          endsAt: new Date('2026-09-02T15:00:00Z'),
        }),
        evento({
          id: 'b',
          connectionId: 'c2',
          connectionLabel: 'Trabalho',
          dedupeKey: 'evt:b',
          startsAt: new Date('2026-09-02T14:30:00Z'),
          endsAt: new Date('2026-09-02T15:30:00Z'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA, ...UTC },
    );

    expect(dias[2]?.conflicts).toHaveLength(1);
    expect(dias[2]?.conflicts[0]?.crossAccount).toBe(true);
  });

  it('marca o dia de hoje', () => {
    const dias = buildWeek([], CORES, inicio, { now: QUARTA, ...UTC });
    expect(dias.filter((d) => d.isToday)).toHaveLength(1);
    expect(dias[2]?.isToday).toBe(true);
  });

  it('NAO marca "hoje" numa semana que nao contem hoje', () => {
    // Bug encontrado navegando na tela: a semana a mostrar e a data de
    // referencia; "hoje" e o instante real. Confundir os dois marcava o dia
    // equivalente da semana passada como hoje.
    const semanaPassada = weekBounds(new Date('2026-08-26T12:00:00Z'), 'UTC').start;
    const dias = buildWeek([], CORES, semanaPassada, { now: QUARTA, ...UTC });
    expect(dias.filter((d) => d.isToday)).toHaveLength(0);
  });

  it('acha as janelas livres do expediente', () => {
    const dias = buildWeek(
      [
        evento({
          id: 'a',
          startsAt: new Date('2026-09-02T09:00:00Z'),
          endsAt: new Date('2026-09-02T12:00:00Z'),
        }),
      ],
      CORES,
      inicio,
      { now: QUARTA, ...UTC },
    );
    // Sobra 12h–18h.
    expect(dias[2]?.freeWindows[0]?.minutes).toBe(360);
  });
});

describe('summarizeWeek', () => {
  const inicio = weekBounds(QUARTA, 'UTC').start;

  it('conta quantas cópias a unificação poupou', () => {
    // E a prova de que a unificacao esta servindo para alguma coisa.
    const eventos = [
      evento({
        id: 'a',
        connectionId: 'c1',
        dedupeKey: 'evt:x',
        startsAt: new Date('2026-09-02T14:00:00Z'),
        endsAt: new Date('2026-09-02T15:00:00Z'),
      }),
      evento({
        id: 'b',
        connectionId: 'c2',
        dedupeKey: 'evt:x',
        startsAt: new Date('2026-09-02T14:00:00Z'),
        endsAt: new Date('2026-09-02T15:00:00Z'),
      }),
    ];
    const resumo = summarizeWeek(buildWeek(eventos, CORES, inicio, { now: QUARTA, ...UTC }), eventos);

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
        startsAt: new Date('2026-09-02T14:00:00Z'),
        endsAt: new Date('2026-09-02T15:00:00Z'),
      }),
      evento({
        id: 'b',
        connectionId: 'c2',
        dedupeKey: 'evt:b',
        startsAt: new Date('2026-09-02T14:30:00Z'),
        endsAt: new Date('2026-09-02T15:30:00Z'),
      }),
    ];
    expect(summarizeWeek(buildWeek(eventos, CORES, inicio, { now: QUARTA, ...UTC }), eventos)
      .crossAccountConflicts).toBe(1);
  });

  it('semana vazia devolve zeros, sem inventar', () => {
    const resumo = summarizeWeek(buildWeek([], CORES, inicio, { now: QUARTA, ...UTC }), []);
    expect(resumo).toMatchObject({ total: 0, crossAccountConflicts: 0, collapsed: 0 });
  });
});

describe('fuso do usuário, não do servidor', () => {
  // O bug que motivou o módulo de fuso: as páginas são renderizadas no
  // servidor, e este servidor roda em UTC. Sem passar o fuso, um
  // compromisso das 21:00 em São Paulo cairia no dia seguinte.
  const inicioSP = weekBounds(QUARTA, SP).start;

  const noiteDeQuarta = evento({
    id: 'noite',
    title: 'Jantar com cliente',
    // 2026-09-03T00:30Z = 2026-09-02 21:30 em São Paulo.
    startsAt: new Date('2026-09-03T00:30:00Z'),
    endsAt: new Date('2026-09-03T02:00:00Z'),
  });

  it('coloca o compromisso da noite no dia CERTO em São Paulo', () => {
    const dias = buildWeek([noiteDeQuarta], CORES, inicioSP, {
      now: QUARTA,
      timeZone: SP,
    });

    expect(dias[2]?.entries).toHaveLength(1); // quarta
    expect(dias[3]?.entries).toHaveLength(0); // quinta
  });

  it('e no dia ERRADO se o fuso do servidor mandasse — a prova do bug', () => {
    const dias = buildWeek([noiteDeQuarta], CORES, weekBounds(QUARTA, 'UTC').start, {
      now: QUARTA,
      timeZone: 'UTC',
    });

    // Em UTC já é quinta-feira: exatamente o que o usuário via antes.
    expect(dias[2]?.entries).toHaveLength(0);
    expect(dias[3]?.entries).toHaveLength(1);
  });

  it('o expediente é hora de parede do usuário, não 09:00 UTC', () => {
    const manha = evento({
      id: 'manha',
      // 12:00Z = 09:00 em São Paulo: ocupa o começo do expediente.
      startsAt: new Date('2026-09-02T12:00:00Z'),
      endsAt: new Date('2026-09-02T15:00:00Z'),
    });

    const dias = buildWeek([manha], CORES, inicioSP, { now: QUARTA, timeZone: SP });
    // Sobra 12:00–18:00 locais = 360min.
    expect(dias[2]?.freeWindows[0]?.minutes).toBe(360);
  });

  it('marca "hoje" pelo dia do usuário', () => {
    // 2026-09-03T01:00Z ainda é 02/09 em São Paulo.
    const dias = buildWeek([], CORES, inicioSP, {
      now: new Date('2026-09-03T01:00:00Z'),
      timeZone: SP,
    });
    expect(dias[2]?.isToday).toBe(true);
    expect(dias[3]?.isToday).toBe(false);
  });
});

describe('visão de mês', () => {
  it('a grade cobre semanas inteiras, de segunda a domingo', () => {
    // Sem expandir, a primeira e a última linha teriam buracos e um
    // compromisso do dia 31 do mês anterior sumiria mesmo estando na
    // mesma semana.
    const { start, end } = monthGridBounds(new Date('2026-09-15T12:00:00Z'), 'UTC');
    expect(start.getUTCDay()).toBe(1); // segunda
    expect(end.getUTCDay()).toBe(1); // exclusivo: segunda seguinte
    expect((end.getTime() - start.getTime()) % (7 * 86_400_000)).toBe(0);
  });

  it('setembro de 2026 começa numa terça, então a grade puxa 31/08', () => {
    const { start } = monthGridBounds(new Date('2026-09-15T12:00:00Z'), 'UTC');
    expect(start.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('marca quais dias são do mês e quais são sobra de semana', () => {
    const { days } = buildMonth([], CORES, new Date('2026-09-15T12:00:00Z'), UTC);

    expect(days[0]?.inMonth).toBe(false); // 31/08
    expect(days[1]?.inMonth).toBe(true); // 01/09
    expect(days.filter((d) => d.inMonth)).toHaveLength(30); // setembro
    expect(days.length % 7).toBe(0);
  });

  it('colapsa cópias também na visão de mês', () => {
    // Reaproveita buildWeek justamente para nao divergir da semana.
    const eventos = [
      evento({
        id: 'a',
        connectionId: 'c1',
        dedupeKey: 'evt:x',
        startsAt: new Date('2026-09-15T14:00:00Z'),
        endsAt: new Date('2026-09-15T15:00:00Z'),
      }),
      evento({
        id: 'b',
        connectionId: 'c2',
        connectionLabel: 'Trabalho',
        dedupeKey: 'evt:x',
        startsAt: new Date('2026-09-15T14:00:00Z'),
        endsAt: new Date('2026-09-15T15:00:00Z'),
      }),
    ];
    const { days } = buildMonth(eventos, CORES, new Date('2026-09-15T12:00:00Z'), UTC);
    const dia15 = days.find((d) => d.date.toISOString().slice(0, 10) === '2026-09-15');

    expect(dia15?.entries).toHaveLength(1);
    expect(dia15?.entries[0]?.accounts).toHaveLength(2);
  });

  it('sinaliza o dia que tem conflito entre contas', () => {
    const eventos = [
      evento({
        id: 'a',
        connectionId: 'c1',
        dedupeKey: 'evt:a',
        startsAt: new Date('2026-09-15T14:00:00Z'),
        endsAt: new Date('2026-09-15T15:00:00Z'),
      }),
      evento({
        id: 'b',
        connectionId: 'c2',
        dedupeKey: 'evt:b',
        startsAt: new Date('2026-09-15T14:30:00Z'),
        endsAt: new Date('2026-09-15T15:30:00Z'),
      }),
    ];
    const { days } = buildMonth(eventos, CORES, new Date('2026-09-15T12:00:00Z'), UTC);
    expect(days.find((d) => d.date.toISOString().slice(0, 10) === '2026-09-15')
      ?.hasCrossAccountConflict).toBe(true);
  });
});

describe('shiftMonths', () => {
  it('anda de mês em mês', () => {
    const out = shiftMonths(new Date('2026-09-15T12:00:00Z'), 1, 'UTC');
    expect(isoDateInZone(out, 'UTC').slice(0, 7)).toBe('2026-10');
  });

  it('NÃO estoura ao sair de um mês de 31 dias', () => {
    // O bug clássico: 31 de janeiro + 1 mês vira 2 ou 3 de março. Ancorar
    // no dia 1 é o que evita.
    const out = shiftMonths(new Date('2026-01-31T12:00:00Z'), 1, 'UTC');
    expect(isoDateInZone(out, 'UTC').slice(0, 7)).toBe('2026-02');
  });

  it('vira o ano nos dois sentidos', () => {
    expect(isoDateInZone(shiftMonths(new Date('2026-12-15T12:00:00Z'), 1, 'UTC'), 'UTC').slice(0, 7))
      .toBe('2027-01');
    expect(isoDateInZone(shiftMonths(new Date('2026-01-15T12:00:00Z'), -1, 'UTC'), 'UTC').slice(0, 7))
      .toBe('2025-12');
  });
});
