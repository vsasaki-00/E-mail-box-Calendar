import { describe, expect, it } from 'vitest';
import { buildTimeline, dayBounds } from './control-tower';
import type { ConflictCandidate } from './conflicts';

const CORES = new Map([
  ['google', '#ea4335'],
  ['microsoft', '#0078d4'],
]);

function evento(over: Partial<ConflictCandidate> & { id: string }): ConflictCandidate {
  return {
    connectionId: 'google',
    connectionLabel: 'pessoal@gmail.com',
    title: 'Evento',
    startsAt: new Date('2026-08-30T13:00:00Z'),
    endsAt: new Date('2026-08-30T14:00:00Z'),
    isAllDay: false,
    status: 'CONFIRMED',
    ...over,
  };
}

describe('buildTimeline', () => {
  it('colapsa o mesmo compromisso recebido em duas contas', () => {
    // A promessa central do produto: o convite que chega em 3 caixas vira 1 linha.
    const linhas = buildTimeline(
      [
        evento({ id: 'a', connectionId: 'google', dedupeKey: 'evt:ical:x' }),
        evento({
          id: 'b',
          connectionId: 'microsoft',
          connectionLabel: 'trabalho@empresa.com',
          dedupeKey: 'evt:ical:x',
        }),
      ],
      CORES,
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.accounts).toHaveLength(2);
    expect(linhas[0]?.accounts.map((c) => c.color)).toEqual(['#ea4335', '#0078d4']);
  });

  it('mantem separados eventos distintos sem chave de deduplicacao', () => {
    // Sem dedupeKey nada pode ser agrupado por engano.
    const linhas = buildTimeline(
      [evento({ id: 'a', dedupeKey: null }), evento({ id: 'b', dedupeKey: null })],
      CORES,
    );
    expect(linhas).toHaveLength(2);
  });

  it('nao repete a mesma conta quando ha duas copias na mesma caixa', () => {
    const linhas = buildTimeline(
      [
        evento({ id: 'a', dedupeKey: 'evt:ical:x' }),
        evento({ id: 'b', dedupeKey: 'evt:ical:x' }),
      ],
      CORES,
    );
    expect(linhas[0]?.accounts).toHaveLength(1);
  });

  it('descarta cancelados e ordena por horario de inicio', () => {
    const linhas = buildTimeline(
      [
        evento({
          id: 'tarde',
          dedupeKey: 'b',
          startsAt: new Date('2026-08-30T18:00:00Z'),
          endsAt: new Date('2026-08-30T19:00:00Z'),
        }),
        evento({ id: 'cancelado', dedupeKey: 'c', status: 'CANCELLED' }),
        evento({ id: 'cedo', dedupeKey: 'a' }),
      ],
      CORES,
    );

    expect(linhas.map((l) => l.id)).toEqual(['cedo', 'tarde']);
  });

  it('usa uma cor de fallback para conexao desconhecida', () => {
    const linhas = buildTimeline([evento({ id: 'a', connectionId: 'sumida' })], CORES);
    expect(linhas[0]?.accounts[0]?.color).toBe('#6366f1');
  });
});

describe('dayBounds', () => {
  it('cobre exatamente 24h a partir da meia-noite local', () => {
    const { start, end } = dayBounds(new Date('2026-08-30T15:23:45'));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000);
  });
});

describe('buildTimeline — deduplicação de contas', () => {
  it('duas conexões com o MESMO nome continuam sendo duas contas', () => {
    // Deduplicar por rótulo mostraria uma bolinha só, e a linha diria que o
    // compromisso existe em menos caixas do que existe de verdade.
    const base = {
      title: 'Reunião',
      startsAt: new Date('2026-09-02T14:00:00Z'),
      endsAt: new Date('2026-09-02T15:00:00Z'),
      isAllDay: false,
      status: 'CONFIRMED' as const,
      dedupeKey: 'evt:x',
    };

    const linhas = buildTimeline(
      [
        { ...base, id: 'a', connectionId: 'c1', connectionLabel: 'Trabalho' },
        { ...base, id: 'b', connectionId: 'c2', connectionLabel: 'Trabalho' },
      ],
      new Map([
        ['c1', '#111'],
        ['c2', '#222'],
      ]),
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.accounts).toHaveLength(2);
  });

  it('a mesma conexão não é contada duas vezes', () => {
    const base = {
      title: 'Reunião',
      startsAt: new Date('2026-09-02T14:00:00Z'),
      endsAt: new Date('2026-09-02T15:00:00Z'),
      isAllDay: false,
      status: 'CONFIRMED' as const,
      dedupeKey: 'evt:x',
      connectionId: 'c1',
      connectionLabel: 'Trabalho',
    };

    const linhas = buildTimeline(
      [{ ...base, id: 'a' }, { ...base, id: 'b' }],
      new Map([['c1', '#111']]),
    );
    expect(linhas[0]?.accounts).toHaveLength(1);
  });
});
