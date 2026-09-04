import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { RawCalendar, RawEvent, RawMailbox, RawMessage } from '@/lib/connectors/types';
import { eventDedupeKey, messageDedupeKey } from '@/core/unified/dedupe';

/**
 * Grava o que o conector trouxe, no modelo canonico.
 *
 * Regras que valem em todo este modulo:
 *  - upsert por (connectionId, providerId): reprocessar a mesma pagina e
 *    inofensivo, o que permite ao motor retomar sync interrompido sem medo;
 *  - toda copia entra em um UnifiedItem pela chave de deduplicacao;
 *  - apagar uma copia nunca apaga as outras — o UnifiedItem so morre quando
 *    perde a ultima.
 */

export interface PersistCounts {
  created: number;
  updated: number;
  deleted: number;
  /**
   * Itens que o provedor entregou e que foram DESCARTADOS por pertencerem a
   * um container (caixa ou calendário) que não está no mapa.
   *
   * Existe porque o descarte é um `continue` silencioso: "achou calendário,
   * não gravou evento" e "não veio evento nenhum" produzem exatamente a
   * mesma tela, e pedem consertos opostos. Contar separa os dois.
   */
  skippedUnknownContainer: number;
  /**
   * A gravação parou no meio por falta de tempo.
   *
   * Interromper aqui é seguro — e essa é a razão de existir: toda escrita é
   * idempotente (upsert por chave do provedor) e o cursor da página só avança
   * no fim. Parar no meio custa refazer a página na volta seguinte, e nada
   * mais. O que NÃO é seguro é avançar o cursor com metade da página gravada,
   * então quem lê isto trata a volta como parcial.
   */
  interrompido?: boolean;
}

const VAZIO: PersistCounts = { created: 0, updated: 0, deleted: 0, skippedUnknownContainer: 0 };

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export async function persistMailboxes(
  connectionId: string,
  caixas: RawMailbox[],
): Promise<Map<string, string>> {
  const porProviderId = new Map<string, string>();

  for (const caixa of caixas) {
    const registro = await prisma.mailbox.upsert({
      where: { connectionId_providerId: { connectionId, providerId: caixa.providerId } },
      create: {
        connectionId,
        providerId: caixa.providerId,
        name: caixa.name,
        role: caixa.role,
        // Por padrao so a caixa de entrada entra na visao unificada; o usuario
        // adiciona as outras. Trazer SPAM e TRASH por default seria hostil.
        includeInUnified: caixa.role === 'INBOX',
        unreadCount: caixa.unreadCount ?? 0,
        totalCount: caixa.totalCount ?? 0,
      },
      // includeInUnified nao e sobrescrito: e escolha do usuario, nao do provedor.
      update: {
        name: caixa.name,
        role: caixa.role,
        unreadCount: caixa.unreadCount ?? 0,
        totalCount: caixa.totalCount ?? 0,
      },
    });
    porProviderId.set(caixa.providerId, registro.id);
  }

  return porProviderId;
}

export async function persistCalendars(
  connectionId: string,
  calendarios: RawCalendar[],
): Promise<Map<string, string>> {
  const porProviderId = new Map<string, string>();

  for (const calendario of calendarios) {
    const registro = await prisma.calendarSource.upsert({
      where: { connectionId_providerId: { connectionId, providerId: calendario.providerId } },
      create: {
        connectionId,
        providerId: calendario.providerId,
        name: calendario.name,
        timezone: calendario.timezone,
        color: calendario.color,
        isPrimary: calendario.isPrimary,
        isReadOnly: calendario.isReadOnly,
      },
      update: {
        name: calendario.name,
        timezone: calendario.timezone,
        color: calendario.color,
        isPrimary: calendario.isPrimary,
        isReadOnly: calendario.isReadOnly,
      },
    });
    porProviderId.set(calendario.providerId, registro.id);
  }

  return porProviderId;
}

// ---------------------------------------------------------------------------
// Itens
// ---------------------------------------------------------------------------

async function vincularUnifiedItem(
  userId: string,
  kind: 'MESSAGE' | 'EVENT',
  dedupeKey: string,
  title: string | undefined,
  preview: string | undefined,
  occurredAt: Date,
): Promise<string> {
  const item = await prisma.unifiedItem.upsert({
    where: { userId_dedupeKey: { userId, dedupeKey } },
    create: { userId, kind, dedupeKey, title, preview, occurredAt, copyCount: 0 },
    // copyCount e recalculado ao final do lote, nao incrementado aqui: um
    // reprocessamento da mesma pagina inflaria a contagem para sempre.
    update: { title, preview, occurredAt },
    select: { id: true },
  });
  return item.id;
}

/** Recalcula copyCount a partir da realidade e remove itens sem nenhuma copia. */
async function reconciliarUnifiedItems(ids: string[]): Promise<void> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return;

  const [mensagens, eventos] = await Promise.all([
    prisma.message.groupBy({
      by: ['unifiedItemId'],
      where: { unifiedItemId: { in: unicos } },
      _count: { _all: true },
    }),
    prisma.calendarEvent.groupBy({
      by: ['unifiedItemId'],
      where: { unifiedItemId: { in: unicos } },
      _count: { _all: true },
    }),
  ]);

  const contagem = new Map<string, number>();
  for (const linha of [...mensagens, ...eventos]) {
    if (!linha.unifiedItemId) continue;
    contagem.set(linha.unifiedItemId, (contagem.get(linha.unifiedItemId) ?? 0) + linha._count._all);
  }

  const orfaos = unicos.filter((id) => !contagem.has(id));

  await prisma.$transaction([
    ...[...contagem.entries()].map(([id, copyCount]) =>
      prisma.unifiedItem.update({ where: { id }, data: { copyCount } }),
    ),
    // O item so morre quando perdeu a ultima copia.
    ...(orfaos.length > 0
      ? [prisma.unifiedItem.deleteMany({ where: { id: { in: orfaos } } })]
      : []),
  ]);
}

/**
 * Hora de parar de gravar?
 *
 * O primeiro item passa SEMPRE, mesmo com o prazo ja vencido: uma volta que
 * grava zero itens e sempre marcada como parcial pede outra volta igual a
 * ela, e o sync nunca sai do lugar. Progresso lento termina; progresso zero,
 * nao.
 */
export function acabouOTempo(prazoEm: number | undefined, jaGravados: number): boolean {
  if (prazoEm === undefined || jaGravados === 0) return false;
  return Date.now() >= prazoEm;
}

export async function persistMessages(params: {
  connectionId: string;
  userId: string;
  mensagens: RawMessage[];
  removidos?: string[];
  mailboxIdPorProviderId: Map<string, string>;
  /** Instante (epoch ms) a partir do qual parar de gravar. */
  prazoEm?: number;
}): Promise<PersistCounts> {
  const { connectionId, userId, mensagens, mailboxIdPorProviderId, prazoEm } = params;
  const removidos = params.removidos ?? [];

  if (mensagens.length === 0 && removidos.length === 0) return VAZIO;

  const contagem = { ...VAZIO };
  const itensTocados: string[] = [];

  for (const mensagem of mensagens) {
    if (acabouOTempo(prazoEm, contagem.created + contagem.updated)) {
      contagem.interrompido = true;
      break;
    }

    const dedupeKey = messageDedupeKey({
      rfcMessageId: mensagem.rfcMessageId,
      fromEmail: mensagem.fromEmail,
      subject: mensagem.subject,
      receivedAt: mensagem.receivedAt,
    });

    const unifiedItemId = await vincularUnifiedItem(
      userId,
      'MESSAGE',
      dedupeKey,
      mensagem.subject ?? undefined,
      mensagem.fromEmail ?? undefined,
      mensagem.receivedAt,
    );
    itensTocados.push(unifiedItemId);

    const dados = {
      mailboxId: mensagem.mailboxProviderId
        ? (mailboxIdPorProviderId.get(mensagem.mailboxProviderId) ?? null)
        : null,
      providerThreadId: mensagem.providerThreadId,
      rfcMessageId: mensagem.rfcMessageId,
      unifiedItemId,
      subject: mensagem.subject,
      snippet: mensagem.snippet,
      fromName: mensagem.fromName,
      fromEmail: mensagem.fromEmail,
      toEmails: mensagem.toEmails as Prisma.InputJsonValue,
      ccEmails: mensagem.ccEmails as Prisma.InputJsonValue,
      receivedAt: mensagem.receivedAt,
      isRead: mensagem.isRead,
      isFlagged: mensagem.isFlagged,
      hasAttachments: mensagem.hasAttachments,
      labels: mensagem.labels as Prisma.InputJsonValue,
    };

    const existente = await prisma.message.findUnique({
      where: { connectionId_providerId: { connectionId, providerId: mensagem.providerId } },
      select: { id: true, unifiedItemId: true },
    });

    if (existente) {
      // A copia pode estar trocando de UnifiedItem (o assunto mudou e a chave
      // de fallback mudou junto): o item antigo tambem precisa ser reconciliado.
      if (existente.unifiedItemId) itensTocados.push(existente.unifiedItemId);
      await prisma.message.update({ where: { id: existente.id }, data: dados });
      contagem.updated += 1;
    } else {
      await prisma.message.create({
        data: { connectionId, providerId: mensagem.providerId, ...dados },
      });
      contagem.created += 1;
    }
  }

  if (removidos.length > 0) {
    const alvos = await prisma.message.findMany({
      where: { connectionId, providerId: { in: removidos } },
      select: { id: true, unifiedItemId: true },
    });
    for (const alvo of alvos) if (alvo.unifiedItemId) itensTocados.push(alvo.unifiedItemId);

    const resultado = await prisma.message.deleteMany({
      where: { id: { in: alvos.map((a) => a.id) } },
    });
    contagem.deleted = resultado.count;
  }

  await reconciliarUnifiedItems(itensTocados);
  return contagem;
}

export async function persistEvents(params: {
  connectionId: string;
  userId: string;
  eventos: RawEvent[];
  removidos?: string[];
  calendarIdPorProviderId: Map<string, string>;
  /** Instante (epoch ms) a partir do qual parar de gravar. */
  prazoEm?: number;
}): Promise<PersistCounts> {
  const { connectionId, userId, eventos, calendarIdPorProviderId, prazoEm } = params;
  const removidos = params.removidos ?? [];

  if (eventos.length === 0 && removidos.length === 0) return VAZIO;

  const contagem = { ...VAZIO };
  const itensTocados: string[] = [];

  for (const evento of eventos) {
    if (acabouOTempo(prazoEm, contagem.created + contagem.updated)) {
      contagem.interrompido = true;
      break;
    }

    const calendarSourceId = calendarIdPorProviderId.get(evento.calendarProviderId);
    // Evento de um calendario que ainda nao conhecemos: sera pego no proximo
    // ciclo, depois da redescoberta. Ignorar e melhor que gravar orfao — mas
    // CONTAR, senao o descarte fica indistinguivel de "nao veio evento".
    if (!calendarSourceId) {
      contagem.skippedUnknownContainer += 1;
      continue;
    }

    const dedupeKey = eventDedupeKey({
      iCalUid: evento.iCalUid,
      title: evento.title,
      startsAt: evento.startsAt,
      organizerEmail: evento.organizerEmail,
    });

    const unifiedItemId = await vincularUnifiedItem(
      userId,
      'EVENT',
      dedupeKey,
      evento.title ?? undefined,
      evento.organizerEmail ?? undefined,
      evento.startsAt,
    );
    itensTocados.push(unifiedItemId);

    const dados = {
      calendarSourceId,
      iCalUid: evento.iCalUid,
      recurringEventId: evento.recurringEventId,
      unifiedItemId,
      title: evento.title,
      description: evento.description,
      location: evento.location,
      startsAt: evento.startsAt,
      endsAt: evento.endsAt,
      isAllDay: evento.isAllDay,
      timezone: evento.timezone,
      status: evento.status,
      responseStatus: evento.responseStatus,
      organizerEmail: evento.organizerEmail,
      attendees: evento.attendees as unknown as Prisma.InputJsonValue,
      conferenceUrl: evento.conferenceUrl,
    };

    const existente = await prisma.calendarEvent.findUnique({
      where: { connectionId_providerId: { connectionId, providerId: evento.providerId } },
      select: { id: true, unifiedItemId: true },
    });

    if (existente) {
      if (existente.unifiedItemId) itensTocados.push(existente.unifiedItemId);
      await prisma.calendarEvent.update({ where: { id: existente.id }, data: dados });
      contagem.updated += 1;
    } else {
      await prisma.calendarEvent.create({
        data: { connectionId, providerId: evento.providerId, ...dados },
      });
      contagem.created += 1;
    }
  }

  if (removidos.length > 0) {
    const alvos = await prisma.calendarEvent.findMany({
      where: { connectionId, providerId: { in: removidos } },
      select: { id: true, unifiedItemId: true },
    });
    for (const alvo of alvos) if (alvo.unifiedItemId) itensTocados.push(alvo.unifiedItemId);

    const resultado = await prisma.calendarEvent.deleteMany({
      where: { id: { in: alvos.map((a) => a.id) } },
    });
    contagem.deleted = resultado.count;
  }

  await reconciliarUnifiedItems(itensTocados);
  return contagem;
}
