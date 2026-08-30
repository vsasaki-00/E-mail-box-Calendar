/**
 * Deteccao de conflitos de agenda. Ver docs/05-torre-de-controle.md
 *
 * Este e o bloco que justifica o produto: sobreposicao entre calendarios de
 * contas diferentes e exatamente o que nenhum cliente de e-mail mostra hoje.
 */

export interface ConflictCandidate {
  id: string;
  connectionId: string;
  connectionLabel: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** Chave de deduplicacao: copias do mesmo evento nao sao conflito. */
  dedupeKey?: string | null;
}

export interface Conflict {
  a: ConflictCandidate;
  b: ConflictCandidate;
  overlapMinutes: number;
  /** Sobreposicao entre contas diferentes e o caso critico. */
  crossAccount: boolean;
}

function overlapMs(a: ConflictCandidate, b: ConflictCandidate): number {
  const start = Math.max(a.startsAt.getTime(), b.startsAt.getTime());
  const end = Math.min(a.endsAt.getTime(), b.endsAt.getTime());
  return Math.max(0, end - start);
}

/**
 * Encontra sobreposicoes numa lista de eventos.
 *
 * Ignora: eventos cancelados, eventos de dia inteiro (nao bloqueiam horario) e
 * pares que sao a mesma reuniao vista de duas contas (mesmo dedupeKey) — senao
 * toda reuniao recebida em duas caixas viraria um falso conflito.
 *
 * Ordena por inicio e para de comparar assim que o proximo evento comeca depois
 * do fim do atual, o que evita comparar todos contra todos no dia cheio.
 */
export function findConflicts(events: ConflictCandidate[]): Conflict[] {
  const relevant = events
    .filter((event) => event.status !== 'CANCELLED' && !event.isAllDay)
    .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());

  const conflicts: Conflict[] = [];

  for (let i = 0; i < relevant.length; i += 1) {
    const current = relevant[i];
    if (!current) continue;

    for (let j = i + 1; j < relevant.length; j += 1) {
      const next = relevant[j];
      if (!next) continue;

      // Lista ordenada por inicio: a partir daqui nada mais sobrepoe `current`.
      if (next.startsAt.getTime() >= current.endsAt.getTime()) break;

      // Mesma reuniao em duas contas: e duplicata, nao conflito.
      if (current.dedupeKey && current.dedupeKey === next.dedupeKey) continue;

      const overlap = overlapMs(current, next);
      if (overlap <= 0) continue;

      conflicts.push({
        a: current,
        b: next,
        overlapMinutes: Math.round(overlap / 60_000),
        crossAccount: current.connectionId !== next.connectionId,
      });
    }
  }

  return conflicts;
}

/**
 * Janelas livres de pelo menos `minMinutes` dentro do expediente.
 * Alimenta a metrica de blocos de foco da Torre de Controle.
 */
export function findFocusWindows(
  events: ConflictCandidate[],
  dayStart: Date,
  dayEnd: Date,
  minMinutes = 90,
): { start: Date; end: Date; minutes: number }[] {
  const busy = events
    .filter((event) => event.status !== 'CANCELLED' && !event.isAllDay)
    .map((event) => ({ start: event.startsAt, end: event.endsAt }))
    .sort((x, y) => x.start.getTime() - y.start.getTime());

  // Funde intervalos sobrepostos antes de procurar os buracos.
  const merged: { start: Date; end: Date }[] = [];
  for (const slot of busy) {
    const last = merged[merged.length - 1];
    if (last && slot.start.getTime() <= last.end.getTime()) {
      if (slot.end.getTime() > last.end.getTime()) last.end = slot.end;
    } else {
      merged.push({ start: slot.start, end: slot.end });
    }
  }

  const windows: { start: Date; end: Date; minutes: number }[] = [];
  let cursor = dayStart;

  for (const slot of merged) {
    if (slot.start.getTime() > cursor.getTime()) {
      const minutes = Math.round((slot.start.getTime() - cursor.getTime()) / 60_000);
      if (minutes >= minMinutes) windows.push({ start: cursor, end: slot.start, minutes });
    }
    if (slot.end.getTime() > cursor.getTime()) cursor = slot.end;
  }

  if (cursor.getTime() < dayEnd.getTime()) {
    const minutes = Math.round((dayEnd.getTime() - cursor.getTime()) / 60_000);
    if (minutes >= minMinutes) windows.push({ start: cursor, end: dayEnd, minutes });
  }

  return windows;
}
