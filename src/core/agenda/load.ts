import { prisma } from '@/lib/db';
import type { ConflictCandidate } from '@/core/metrics/conflicts';
import { buildWeek, summarizeWeek, weekBounds, type AgendaDay, type WeekSummary } from './week';

/**
 * Carrega a agenda unificada de uma semana. Ver docs/05-torre-de-controle.md
 *
 * Le do cache local, como o resto da Torre: a agenda precisa abrir mesmo
 * com todas as contas fora do ar, mostrando o estado conhecido.
 */

export interface AgendaData {
  weekStart: Date;
  weekEnd: Date;
  days: AgendaDay[];
  summary: WeekSummary;
  connections: { id: string; label: string; color: string }[];
}

/**
 * `referencia` escolhe QUAL semana mostrar; `agora` e o instante real.
 *
 * Sao coisas diferentes, e confundi-las e um bug que os testes pegaram:
 * navegando para a semana passada, o dia equivalente daquela semana era
 * marcado como "hoje".
 */
export async function loadAgenda(
  userId: string,
  referencia = new Date(),
  connectionId?: string | null,
  agora = new Date(),
): Promise<AgendaData> {
  const { start, end } = weekBounds(referencia);

  const [connections, eventos] = await Promise.all([
    prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, accountEmail: true, displayName: true, color: true },
    }),
    prisma.calendarEvent.findMany({
      where: {
        connection: { userId, ...(connectionId ? { id: connectionId } : {}) },
        calendarSource: { includeInUnified: true },
        // Sobreposicao com a semana, e nao "comeca na semana": um evento de
        // varios dias que comecou no domingo anterior precisa aparecer.
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      orderBy: { startsAt: 'asc' },
      include: {
        unifiedItem: { select: { dedupeKey: true } },
        connection: { select: { accountEmail: true, displayName: true } },
      },
    }),
  ]);

  const candidatos: ConflictCandidate[] = eventos.map((evento) => ({
    id: evento.id,
    connectionId: evento.connectionId,
    connectionLabel: evento.connection.displayName ?? evento.connection.accountEmail,
    title: evento.title ?? '(sem título)',
    startsAt: evento.startsAt,
    endsAt: evento.endsAt,
    isAllDay: evento.isAllDay,
    status: evento.status,
    dedupeKey: evento.unifiedItem?.dedupeKey ?? null,
  }));

  const cores = new Map(connections.map((c) => [c.id, c.color]));
  const days = buildWeek(candidatos, cores, start, { now: agora });

  return {
    weekStart: start,
    weekEnd: end,
    days,
    summary: summarizeWeek(days, candidatos),
    connections: connections.map((c) => ({
      id: c.id,
      label: c.displayName ?? c.accountEmail,
      color: c.color,
    })),
  };
}
