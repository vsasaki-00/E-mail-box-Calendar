import { prisma } from '@/lib/db';
import { findConflicts, findFocusWindows, type ConflictCandidate } from './conflicts';
import type { Conflict } from './conflicts';
import { computeSla, mostOverdue, type AwaitingReply, type MailboxSla } from './sla';
import { refreshAlerts } from '@/core/alerts/refresh';
import {
  estadoDaConexao,
  frescorDaConexao,
  type RecursoSincronizado,
} from './estado-conexao';

/**
 * Agregacoes da Torre de Controle. Ver docs/05-torre-de-controle.md
 *
 * Tudo aqui le do cache local (Postgres), nunca dos provedores ao vivo: a tela
 * de comando precisa abrir instantaneamente mesmo com todas as contas fora do
 * ar, mostrando o estado conhecido e a idade desse estado.
 */

export interface ConnectionHealth {
  id: string;
  provider: string;
  accountEmail: string;
  displayName: string | null;
  color: string;
  status: string;
  /**
   * Quando a conta ficou INTEIRA — o sync do recurso mais atrasado dela, e
   * nao `Connection.lastSyncAt`. Ver `frescorDaConexao`.
   */
  lastSyncAt: Date | null;
  lastErrorMessage: string | null;
  /** Minutos desde `lastSyncAt`. null = ha recurso que nunca sincronizou. */
  minutesSinceSync: number | null;
  /** Qual recurso esta segurando a conta atras ('MAIL', 'CALENDAR'). */
  recursoAtrasado: string | null;
  /** Silencio alem da cadencia do agendamento. Silencio nao e saude. */
  isStale: boolean;
  /** A etiqueta que as telas mostram. Uma so, para nao discordarem. */
  rotulo: { classe: string; texto: string };
  unreadCount: number;
  eventsToday: number;
}

export interface TriageBacklog {
  totalUnread: number;
  /** Idade, em horas, do item nao lido mais antigo. A metrica que importa. */
  oldestUnreadHours: number | null;
  byConnection: { connectionId: string; label: string; unread: number }[];
}

/**
 * Resumo da triagem da fase 5A. Ver docs/07-agente-de-triagem.md
 *
 * O ponto do produto: a Torre deixa de dizer "47 nao lidos" e passa a dizer
 * "3 precisam de resposta hoje". `pending` existe porque um numero de
 * triagem so e honesto se disser quanto ainda NAO foi analisado.
 */
export interface TriageSummary {
  needsReply: number;
  urgent: number;
  cobrancas: number;
  /** Classificados com confianca baixa: aparecem para revisao humana. */
  lowConfidence: number;
  /** Itens ainda sem nenhuma triagem. Sem isso, o painel mentiria. */
  pending: number;
}

/**
 * Resumo do painel financeiro (fase 5B).
 *
 * `withoutAmount` existe pelo mesmo motivo de `pending` na triagem: um
 * total que engole as cobrancas sem valor identificado mentiria.
 */
export interface BillsSummary {
  open: number;
  totalOpenCents: number;
  withoutAmount: number;
  overdue: number;
  dueSoon: number;
}

/** Resumo dos rascunhos (fase 5D). Nenhum deles foi enviado. */
export interface DraftsSummary {
  proposed: number;
  approved: number;
  edited: number;
}

/** Um compromisso do dia ja colapsado: uma linha por reuniao, nao por copia. */
export interface TimelineEntry {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
  /** Em quais contas este mesmo compromisso existe. */
  /**
   * Em quais contas este mesmo compromisso existe.
   *
   * `id` e a conexao, e e por ele que a lista deduplica: duas contas que
   * voce nomeou igual ("Trabalho") sao duas contas, e mostrar uma bolinha
   * so diria que o compromisso existe em menos caixas do que existe.
   */
  accounts: { id: string; label: string; color: string }[];
}

export interface ControlTowerData {
  generatedAt: Date;
  connections: ConnectionHealth[];
  /** Copias cruas, usadas para detectar conflitos. */
  todayEvents: ConflictCandidate[];
  /** Visao unificada do dia: copias do mesmo evento viram uma linha so. */
  timeline: TimelineEntry[];
  conflicts: Conflict[];
  focusWindows: { start: Date; end: Date; minutes: number }[];
  backlog: TriageBacklog;
  triage: TriageSummary;
  /** Prazo de resposta por caixa. Substitui "nao lidos" como metrica. */
  sla: MailboxSla[];
  /** Os itens que mais precisam de voce agora. */
  overdueItems: (AwaitingReply & { hours: number; overdue: boolean })[];
  bills: BillsSummary;
  drafts: DraftsSummary;
  alerts: {
    id: string;
    severity: string;
    kind: string;
    title: string;
    detail: string | null;
    createdAt: Date;
  }[];
}

/**
 * Colapsa as copias do mesmo compromisso em uma unica linha.
 *
 * Sem isso a agenda unificada mostra a mesma reuniao uma vez por caixa, que e
 * exatamente o problema que o produto existe para resolver. Eventos sem chave
 * de deduplicacao caem para a propria identidade, e nunca sao agrupados por
 * engano com outro evento.
 */
export function buildTimeline(
  events: ConflictCandidate[],
  colorByConnection: Map<string, string>,
): TimelineEntry[] {
  const porChave = new Map<string, TimelineEntry>();

  for (const evento of events) {
    if (evento.status === 'CANCELLED') continue;

    const chave = evento.dedupeKey ?? `id:${evento.id}`;
    const conta = {
      id: evento.connectionId,
      label: evento.connectionLabel,
      color: colorByConnection.get(evento.connectionId) ?? '#6366f1',
    };

    const existente = porChave.get(chave);
    if (existente) {
      // Mesma reuniao vista de outra conta: acrescenta a conta, nao a linha.
      if (!existente.accounts.some((a) => a.id === conta.id)) {
        existente.accounts.push(conta);
      }
      continue;
    }

    porChave.set(chave, {
      id: evento.id,
      title: evento.title,
      startsAt: evento.startsAt,
      endsAt: evento.endsAt,
      isAllDay: evento.isAllDay,
      accounts: [conta],
    });
  }

  return [...porChave.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function dayBounds(reference = new Date()): { start: Date; end: Date } {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function loadControlTower(userId: string, now = new Date()): Promise<ControlTowerData> {
  const { start: dayStart, end: dayEnd } = dayBounds(now);

  const [
    connections,
    syncStates,
    events,
    unreadAggregates,
    oldestUnread,
    triageByCategory,
    needsReplyCount,
    urgentCount,
    lowConfidenceCount,
    pendingTriageCount,
    awaitingRaw,
    mailboxProfiles,
    openBills,
    draftGroups,
  ] = await Promise.all([
    prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    // Por RECURSO: uma conta so esta atual quando a parte mais atrasada
    // dela esta. Ver `frescorDaConexao`.
    prisma.syncState.findMany({
      where: { connection: { userId } },
      select: { connectionId: true, resource: true, lastSyncAt: true },
    }),
    prisma.calendarEvent.findMany({
      where: {
        connection: { userId },
        calendarSource: { includeInUnified: true },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      orderBy: { startsAt: 'asc' },
      include: { unifiedItem: { select: { dedupeKey: true } } },
    }),
    prisma.message.groupBy({
      by: ['connectionId'],
      where: { connection: { userId }, isRead: false },
      _count: { _all: true },
    }),
    prisma.message.findFirst({
      where: { connection: { userId }, isRead: false },
      orderBy: { receivedAt: 'asc' },
      select: { receivedAt: true },
    }),
    prisma.itemTriage.groupBy({
      by: ['category'],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.itemTriage.count({ where: { userId, needsReply: true } }),
    prisma.itemTriage.count({ where: { userId, priority: 'URGENT' } }),
    // Confianca baixa nunca some da lista: e o item que precisa de olho.
    prisma.itemTriage.count({ where: { userId, confidence: { lt: 0.6 } } }),
    prisma.unifiedItem.count({ where: { userId, kind: 'MESSAGE', triage: null } }),
    // Quem esta esperando resposta sua — a base do SLA.
    prisma.itemTriage.findMany({
      where: { userId, needsReply: true },
      take: 300,
      select: {
        unifiedItemId: true,
        priority: true,
        unifiedItem: {
          select: {
            title: true,
            occurredAt: true,
            messages: {
              take: 1,
              orderBy: { receivedAt: 'desc' },
              select: { connectionId: true, fromName: true, fromEmail: true, receivedAt: true },
            },
          },
        },
      },
    }),
    prisma.mailboxProfile.findMany({
      where: { connection: { userId } },
      select: { connectionId: true, businessName: true },
    }),
    prisma.billExtraction.findMany({
      where: { userId, status: 'PENDING', isPayable: true },
      select: { unifiedItemId: true, amountCents: true, dueDate: true, payee: true },
    }),
    prisma.draft.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
  ]);

  const unreadByConnection = new Map(
    unreadAggregates.map((row) => [row.connectionId, row._count._all]),
  );

  const candidates: ConflictCandidate[] = events.map((event) => ({
    id: event.id,
    connectionId: event.connectionId,
    connectionLabel:
      connections.find((c) => c.id === event.connectionId)?.accountEmail ?? 'desconhecida',
    title: event.title ?? '(sem titulo)',
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    isAllDay: event.isAllDay,
    status: event.status,
    dedupeKey: event.unifiedItem?.dedupeKey ?? null,
  }));

  const eventsPerConnection = new Map<string, number>();
  for (const event of events) {
    eventsPerConnection.set(
      event.connectionId,
      (eventsPerConnection.get(event.connectionId) ?? 0) + 1,
    );
  }

  const recursosPorConexao = new Map<string, RecursoSincronizado[]>();
  for (const estado of syncStates) {
    const lista = recursosPorConexao.get(estado.connectionId) ?? [];
    lista.push({ resource: estado.resource, lastSyncAt: estado.lastSyncAt });
    recursosPorConexao.set(estado.connectionId, lista);
  }

  const health: ConnectionHealth[] = connections.map((connection) => {
    const frescor = frescorDaConexao(
      connection,
      recursosPorConexao.get(connection.id) ?? [],
      now,
    );
    const rotulo = estadoDaConexao(connection, frescor, now);

    return {
      id: connection.id,
      provider: connection.provider,
      accountEmail: connection.accountEmail,
      displayName: connection.displayName,
      color: connection.color,
      status: connection.status,
      lastSyncAt: frescor.desde,
      lastErrorMessage: connection.lastErrorMessage,
      minutesSinceSync: frescor.minutos,
      recursoAtrasado: frescor.recurso,
      isStale: rotulo.atrasada,
      rotulo: { classe: rotulo.classe, texto: rotulo.texto },
      unreadCount: unreadByConnection.get(connection.id) ?? 0,
      eventsToday: eventsPerConnection.get(connection.id) ?? 0,
    };
  });

  // --- SLA de resposta -----------------------------------------------------
  const negocioPorConexao = new Map(
    mailboxProfiles.map((perfil) => [perfil.connectionId, perfil.businessName] as const),
  );
  const caixasSla = connections.map((conexao) => ({
    connectionId: conexao.id,
    label: conexao.displayName ?? conexao.accountEmail,
    businessName: negocioPorConexao.get(conexao.id) ?? null,
  }));

  const awaiting: AwaitingReply[] = awaitingRaw
    .map((linha): AwaitingReply | null => {
      const mensagem = linha.unifiedItem.messages[0];
      if (!mensagem) return null;
      return {
        unifiedItemId: linha.unifiedItemId,
        connectionId: mensagem.connectionId,
        receivedAt: mensagem.receivedAt,
        priority: linha.priority,
        title: linha.unifiedItem.title ?? '(sem assunto)',
        fromLabel: mensagem.fromName ?? mensagem.fromEmail ?? 'remetente desconhecido',
      };
    })
    .filter((item): item is AwaitingReply => item !== null);

  // --- Cobrancas -----------------------------------------------------------
  const DIA_MS = 86_400_000;
  const hojeUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diasAte = (data: Date | null) =>
    data === null
      ? null
      : Math.round(
          (Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()) - hojeUTC) /
            DIA_MS,
        );

  const cobrancasComPrazo = openBills.map((cobranca) => ({
    unifiedItemId: cobranca.unifiedItemId,
    payee: cobranca.payee,
    amountCents: cobranca.amountCents,
    daysUntilDue: diasAte(cobranca.dueDate),
  }));
  const prazos = cobrancasComPrazo.map((c) => c.daysUntilDue);

  // Expediente usado para as janelas de foco.
  const workStart = new Date(dayStart);
  workStart.setHours(9, 0, 0, 0);
  const workEnd = new Date(dayStart);
  workEnd.setHours(18, 0, 0, 0);

  const conflicts = findConflicts(candidates);
  const sla = computeSla(awaiting, caixasSla, now);

  // Os alertas sao recalculados a partir EXATAMENTE deste estado, e so
  // depois lidos. Uma lista de alertas que discorda dos numeros ao lado
  // dela e pior do que nao ter alerta nenhum. Condicao que deixou de valer
  // some sozinha aqui; reconhecimento seu sobrevive.
  await refreshAlerts(userId, { connections: health, conflicts, sla, bills: cobrancasComPrazo });

  const alerts = await prisma.alert.findMany({
    where: { userId, acknowledgedAt: null },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  });

  return {
    generatedAt: now,
    connections: health,
    todayEvents: candidates,
    timeline: buildTimeline(
      candidates,
      new Map(connections.map((connection) => [connection.id, connection.color])),
    ),
    conflicts,
    focusWindows: findFocusWindows(candidates, workStart, workEnd),
    backlog: {
      totalUnread: [...unreadByConnection.values()].reduce((sum, n) => sum + n, 0),
      oldestUnreadHours: oldestUnread
        ? Math.round((now.getTime() - oldestUnread.receivedAt.getTime()) / 3_600_000)
        : null,
      byConnection: health.map((connection) => ({
        connectionId: connection.id,
        label: connection.displayName ?? connection.accountEmail,
        unread: connection.unreadCount,
      })),
    },
    triage: {
      needsReply: needsReplyCount,
      urgent: urgentCount,
      cobrancas:
        triageByCategory.find((linha) => linha.category === 'COBRANCA')?._count._all ?? 0,
      lowConfidence: lowConfidenceCount,
      pending: pendingTriageCount,
    },
    sla,
    overdueItems: mostOverdue(awaiting, caixasSla, 5, now),
    bills: {
      open: openBills.length,
      // Cobranca sem valor identificado NAO entra no total: somar zero a
      // esconderia, e o painel diria um numero menor do que a realidade.
      totalOpenCents: openBills.reduce((soma, c) => soma + (c.amountCents ?? 0), 0),
      withoutAmount: openBills.filter((c) => c.amountCents === null).length,
      overdue: prazos.filter((d) => d !== null && d < 0).length,
      dueSoon: prazos.filter((d) => d !== null && d >= 0 && d <= 3).length,
    },
    drafts: {
      proposed: draftGroups.find((g) => g.status === 'PROPOSED')?._count._all ?? 0,
      approved: draftGroups.find((g) => g.status === 'APPROVED')?._count._all ?? 0,
      edited: draftGroups.find((g) => g.status === 'EDITED')?._count._all ?? 0,
    },
    alerts: alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      kind: alert.kind,
      title: alert.title,
      detail: alert.detail,
      createdAt: alert.createdAt,
    })),
  };
}
