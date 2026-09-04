import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { RawCalendar, RawEvent, RawMailbox, RawMessage } from '@/lib/connectors/types';
import { eventDedupeKey, messageDedupeKey } from '@/core/unified/dedupe';
import { precisaGravar } from './mudou';

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

interface ChaveDeItem {
  dedupeKey: string;
  title?: string;
  preview?: string;
  occurredAt: Date;
}

/**
 * Resolve TODAS as chaves da pagina de uma vez.
 *
 * Antes era um upsert por item: 25 mensagens, 25 idas ao banco so para isto.
 * Aqui sao tres, no pior caso — uma leitura, uma criacao em massa, e uma
 * releitura para pegar os ids do que foi criado (o `createMany` do Postgres
 * nao devolve ids). Atualizacoes de metadados so acontecem para os itens que
 * realmente mudaram.
 */
async function resolverUnifiedItems(
  userId: string,
  kind: 'MESSAGE' | 'EVENT',
  chaves: ChaveDeItem[],
): Promise<Map<string, string>> {
  const porChave = new Map<string, ChaveDeItem>();
  for (const chave of chaves) porChave.set(chave.dedupeKey, chave);
  const listaDeChaves = [...porChave.keys()];
  if (listaDeChaves.length === 0) return new Map();

  const existentes = await prisma.unifiedItem.findMany({
    where: { userId, dedupeKey: { in: listaDeChaves } },
    select: { id: true, dedupeKey: true, title: true, preview: true, occurredAt: true },
  });
  const idPorChave = new Map(existentes.map((item) => [item.dedupeKey, item.id]));

  const faltando = listaDeChaves.filter((chave) => !idPorChave.has(chave));
  if (faltando.length > 0) {
    await prisma.unifiedItem.createMany({
      data: faltando.map((chave) => {
        const dados = porChave.get(chave) as ChaveDeItem;
        return {
          userId,
          kind,
          dedupeKey: chave,
          title: dados.title,
          preview: dados.preview,
          occurredAt: dados.occurredAt,
          // `copyCount` nasce em 1 e e recalculado no fim: contar aqui, item a
          // item, faria o reprocessamento da mesma pagina inflar para sempre.
          copyCount: 1,
        };
      }),
      // Outra execucao pode ter criado a mesma chave entre a leitura e agora.
      skipDuplicates: true,
    });

    const novos = await prisma.unifiedItem.findMany({
      where: { userId, dedupeKey: { in: faltando } },
      select: { id: true, dedupeKey: true },
    });
    for (const item of novos) idPorChave.set(item.dedupeKey, item.id);
  }

  // Metadado que mudou (o assunto foi editado, o horario mudou) ainda precisa
  // ser gravado — mas so nos itens em que mudou de fato.
  for (const item of existentes) {
    const desejado = porChave.get(item.dedupeKey);
    if (!desejado) continue;
    const dados = {
      title: desejado.title,
      preview: desejado.preview,
      occurredAt: desejado.occurredAt,
    };
    if (precisaGravar(dados, item)) {
      await prisma.unifiedItem.update({ where: { id: item.id }, data: dados });
    }
  }

  return idPorChave;
}

/** Recalcula copyCount a partir da realidade e remove itens sem nenhuma copia. */
async function reconciliarUnifiedItems(ids: string[]): Promise<void> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return;

  const [mensagens, eventos, atuais] = await Promise.all([
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
    // A contagem que ja esta gravada: sem ela, todo item tocado levaria um
    // UPDATE mesmo quando o numero nao mudou — e numa pagina inteira isso e
    // o dobro das escritas, por nada.
    prisma.unifiedItem.findMany({
      where: { id: { in: unicos } },
      select: { id: true, copyCount: true },
    }),
  ]);

  const contagem = new Map<string, number>();
  for (const linha of [...mensagens, ...eventos]) {
    if (!linha.unifiedItemId) continue;
    contagem.set(linha.unifiedItemId, (contagem.get(linha.unifiedItemId) ?? 0) + linha._count._all);
  }

  const gravadoAgora = new Map(atuais.map((item) => [item.id, item.copyCount]));
  const orfaos = unicos.filter((id) => !contagem.has(id));
  const desatualizados = [...contagem.entries()].filter(
    ([id, copyCount]) => gravadoAgora.get(id) !== copyCount,
  );

  if (desatualizados.length === 0 && orfaos.length === 0) return;

  await prisma.$transaction([
    ...desatualizados.map(([id, copyCount]) =>
      prisma.unifiedItem.update({ where: { id }, data: { copyCount } }),
    ),
    // O item so morre quando perdeu a ultima copia.
    ...(orfaos.length > 0
      ? [prisma.unifiedItem.deleteMany({ where: { id: { in: orfaos } } })]
      : []),
  ]);
}

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

  // 1. As chaves de deduplicacao da pagina inteira, resolvidas de uma vez.
  const chaves = mensagens.map((mensagem) => ({
    mensagem,
    dedupeKey: messageDedupeKey({
      rfcMessageId: mensagem.rfcMessageId,
      fromEmail: mensagem.fromEmail,
      subject: mensagem.subject,
      receivedAt: mensagem.receivedAt,
    }),
  }));

  const idPorChave = await resolverUnifiedItems(
    userId,
    'MESSAGE',
    chaves.map(({ mensagem, dedupeKey }) => ({
      dedupeKey,
      title: mensagem.subject ?? undefined,
      preview: mensagem.fromEmail ?? undefined,
      occurredAt: mensagem.receivedAt,
    })),
  );

  // 2. As copias que ja existem, tambem numa consulta so.
  const existentes = await prisma.message.findMany({
    where: { connectionId, providerId: { in: mensagens.map((m) => m.providerId) } },
    select: {
      id: true,
      providerId: true,
      unifiedItemId: true,
      mailboxId: true,
      providerThreadId: true,
      rfcMessageId: true,
      subject: true,
      snippet: true,
      fromName: true,
      fromEmail: true,
      toEmails: true,
      ccEmails: true,
      receivedAt: true,
      isRead: true,
      isFlagged: true,
      hasAttachments: true,
      labels: true,
    },
  });
  const porProviderId = new Map(existentes.map((linha) => [linha.providerId, linha]));

  const paraCriar: Prisma.MessageCreateManyInput[] = [];

  for (const { mensagem, dedupeKey } of chaves) {
    const unifiedItemId = idPorChave.get(dedupeKey);
    // Chave sem item resolvido so acontece se outra execucao apagou o item
    // entre a resolucao e agora. Pular e melhor que gravar copia orfa.
    if (!unifiedItemId) continue;
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

    const existente = porProviderId.get(mensagem.providerId);

    if (!existente) {
      paraCriar.push({ connectionId, providerId: mensagem.providerId, ...dados });
      contagem.created += 1;
      continue;
    }

    // A copia pode estar trocando de UnifiedItem (o assunto mudou e a chave
    // de fallback mudou junto): o item antigo tambem precisa ser reconciliado.
    if (existente.unifiedItemId) itensTocados.push(existente.unifiedItemId);

    // NADA mudou: nao escreve. Este e o caso comum de um incremental, e era
    // ele que custava uma escrita por mensagem sem mudar um byte.
    if (!precisaGravar(dados, existente)) continue;

    if (acabouOTempo(prazoEm, contagem.created + contagem.updated)) {
      contagem.interrompido = true;
      break;
    }

    await prisma.message.update({ where: { id: existente.id }, data: dados });
    contagem.updated += 1;
  }

  if (paraCriar.length > 0) {
    // `skipDuplicates`: outra execucao pode ter gravado a mesma pagina entre
    // a leitura e agora. Reprocessar pagina e normal aqui.
    await prisma.message.createMany({ data: paraCriar, skipDuplicates: true });
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

  // Evento de um calendario que ainda nao conhecemos: sera pego no proximo
  // ciclo, depois da redescoberta. Ignorar e melhor que gravar orfao — mas
  // CONTAR, senao o descarte fica indistinguivel de "nao veio evento".
  const aceitos: { evento: RawEvent; calendarSourceId: string; dedupeKey: string }[] = [];
  for (const evento of eventos) {
    const calendarSourceId = calendarIdPorProviderId.get(evento.calendarProviderId);
    if (!calendarSourceId) {
      contagem.skippedUnknownContainer += 1;
      continue;
    }
    aceitos.push({
      evento,
      calendarSourceId,
      dedupeKey: eventDedupeKey({
        iCalUid: evento.iCalUid,
        title: evento.title,
        startsAt: evento.startsAt,
        organizerEmail: evento.organizerEmail,
      }),
    });
  }

  const idPorChave = await resolverUnifiedItems(
    userId,
    'EVENT',
    aceitos.map(({ evento, dedupeKey }) => ({
      dedupeKey,
      title: evento.title ?? undefined,
      preview: evento.organizerEmail ?? undefined,
      occurredAt: evento.startsAt,
    })),
  );

  const existentes = await prisma.calendarEvent.findMany({
    where: { connectionId, providerId: { in: aceitos.map(({ evento }) => evento.providerId) } },
    select: {
      id: true,
      providerId: true,
      unifiedItemId: true,
      calendarSourceId: true,
      iCalUid: true,
      recurringEventId: true,
      title: true,
      description: true,
      location: true,
      startsAt: true,
      endsAt: true,
      isAllDay: true,
      timezone: true,
      status: true,
      responseStatus: true,
      organizerEmail: true,
      attendees: true,
      conferenceUrl: true,
    },
  });
  const porProviderId = new Map(existentes.map((linha) => [linha.providerId, linha]));

  const paraCriar: Prisma.CalendarEventCreateManyInput[] = [];

  for (const { evento, calendarSourceId, dedupeKey } of aceitos) {
    const unifiedItemId = idPorChave.get(dedupeKey);
    if (!unifiedItemId) continue;
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

    const existente = porProviderId.get(evento.providerId);

    if (!existente) {
      paraCriar.push({ connectionId, providerId: evento.providerId, ...dados });
      contagem.created += 1;
      continue;
    }

    if (existente.unifiedItemId) itensTocados.push(existente.unifiedItemId);
    if (!precisaGravar(dados, existente)) continue;

    if (acabouOTempo(prazoEm, contagem.created + contagem.updated)) {
      contagem.interrompido = true;
      break;
    }

    await prisma.calendarEvent.update({ where: { id: existente.id }, data: dados });
    contagem.updated += 1;
  }

  if (paraCriar.length > 0) {
    await prisma.calendarEvent.createMany({ data: paraCriar, skipDuplicates: true });
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
