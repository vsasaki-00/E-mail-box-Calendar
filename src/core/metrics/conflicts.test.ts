import { describe, expect, it } from 'vitest';
import { findConflicts, findFocusWindows, type ConflictCandidate } from './conflicts';

function evento(over: Partial<ConflictCandidate> & { id: string }): ConflictCandidate {
  return {
    connectionId: 'conta-a',
    connectionLabel: 'conta-a',
    title: 'Evento',
    startsAt: new Date('2026-08-30T13:00:00Z'),
    endsAt: new Date('2026-08-30T14:00:00Z'),
    isAllDay: false,
    status: 'CONFIRMED',
    ...over,
  };
}

describe('findConflicts', () => {
  it('detecta sobreposicao entre contas diferentes', () => {
    const conflitos = findConflicts([
      evento({
        id: 'a',
        connectionId: 'google',
        startsAt: new Date('2026-08-30T14:00:00Z'),
        endsAt: new Date('2026-08-30T15:30:00Z'),
      }),
      evento({
        id: 'b',
        connectionId: 'microsoft',
        startsAt: new Date('2026-08-30T15:00:00Z'),
        endsAt: new Date('2026-08-30T16:00:00Z'),
      }),
    ]);

    expect(conflitos).toHaveLength(1);
    expect(conflitos[0]?.overlapMinutes).toBe(30);
    expect(conflitos[0]?.crossAccount).toBe(true);
  });

  it('nao acusa conflito quando os eventos apenas se encostam', () => {
    const conflitos = findConflicts([
      evento({
        id: 'a',
        startsAt: new Date('2026-08-30T14:00:00Z'),
        endsAt: new Date('2026-08-30T15:00:00Z'),
      }),
      evento({
        id: 'b',
        startsAt: new Date('2026-08-30T15:00:00Z'),
        endsAt: new Date('2026-08-30T16:00:00Z'),
      }),
    ]);
    expect(conflitos).toHaveLength(0);
  });

  it('ignora a mesma reuniao vista de duas contas', () => {
    // O caso que quebraria o produto: todo convite recebido em duas caixas
    // viraria um falso conflito.
    const conflitos = findConflicts([
      evento({ id: 'a', connectionId: 'google', dedupeKey: 'evt:ical:x' }),
      evento({ id: 'b', connectionId: 'microsoft', dedupeKey: 'evt:ical:x' }),
    ]);
    expect(conflitos).toHaveLength(0);
  });

  it('ignora eventos cancelados e de dia inteiro', () => {
    const conflitos = findConflicts([
      evento({ id: 'a' }),
      evento({ id: 'b', connectionId: 'outra', status: 'CANCELLED' }),
      evento({ id: 'c', connectionId: 'terceira', isAllDay: true }),
    ]);
    expect(conflitos).toHaveLength(0);
  });

  it('encontra todos os pares quando tres eventos se sobrepoem', () => {
    const conflitos = findConflicts([
      evento({
        id: 'a',
        connectionId: 'c1',
        startsAt: new Date('2026-08-30T13:00:00Z'),
        endsAt: new Date('2026-08-30T16:00:00Z'),
      }),
      evento({
        id: 'b',
        connectionId: 'c2',
        startsAt: new Date('2026-08-30T14:00:00Z'),
        endsAt: new Date('2026-08-30T15:00:00Z'),
      }),
      evento({
        id: 'c',
        connectionId: 'c3',
        startsAt: new Date('2026-08-30T14:30:00Z'),
        endsAt: new Date('2026-08-30T15:30:00Z'),
      }),
    ]);
    expect(conflitos).toHaveLength(3);
  });
});

describe('findFocusWindows', () => {
  const inicioExpediente = new Date('2026-08-30T12:00:00Z');
  const fimExpediente = new Date('2026-08-30T21:00:00Z');

  it('devolve o expediente inteiro quando nao ha eventos', () => {
    const janelas = findFocusWindows([], inicioExpediente, fimExpediente);
    expect(janelas).toHaveLength(1);
    expect(janelas[0]?.minutes).toBe(540);
  });

  it('encontra o buraco entre duas reunioes', () => {
    const janelas = findFocusWindows(
      [
        evento({
          id: 'a',
          startsAt: new Date('2026-08-30T12:00:00Z'),
          endsAt: new Date('2026-08-30T13:00:00Z'),
        }),
        evento({
          id: 'b',
          startsAt: new Date('2026-08-30T15:00:00Z'),
          endsAt: new Date('2026-08-30T21:00:00Z'),
        }),
      ],
      inicioExpediente,
      fimExpediente,
    );
    expect(janelas).toHaveLength(1);
    expect(janelas[0]?.minutes).toBe(120);
  });

  it('descarta buracos menores que o minimo', () => {
    const janelas = findFocusWindows(
      [
        evento({
          id: 'a',
          startsAt: new Date('2026-08-30T12:00:00Z'),
          endsAt: new Date('2026-08-30T14:00:00Z'),
        }),
        evento({
          id: 'b',
          startsAt: new Date('2026-08-30T15:00:00Z'),
          endsAt: new Date('2026-08-30T21:00:00Z'),
        }),
      ],
      inicioExpediente,
      fimExpediente,
    );
    expect(janelas).toHaveLength(0);
  });

  it('funde reunioes sobrepostas antes de medir o tempo livre', () => {
    // Sem a fusao, a segunda reuniao criaria uma "janela livre" negativa ou
    // duplicada dentro da primeira.
    const janelas = findFocusWindows(
      [
        evento({
          id: 'a',
          startsAt: new Date('2026-08-30T12:00:00Z'),
          endsAt: new Date('2026-08-30T17:00:00Z'),
        }),
        evento({
          id: 'b',
          startsAt: new Date('2026-08-30T14:00:00Z'),
          endsAt: new Date('2026-08-30T15:00:00Z'),
        }),
      ],
      inicioExpediente,
      fimExpediente,
    );
    expect(janelas).toHaveLength(1);
    expect(janelas[0]?.minutes).toBe(240);
  });
});
