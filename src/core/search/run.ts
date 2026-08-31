import { prisma } from '@/lib/db';
import { isRunnable, toTsQuery, type SearchFilters, type SearchHit } from './query';

/**
 * Executa a busca unificada. Ver docs/05-torre-de-controle.md
 *
 * Usa `ILIKE` sobre os campos de metadado, e nao full-text do Postgres,
 * por uma razao pratica: full-text exige escolher a configuracao de idioma
 * (`portuguese`) e criar indice GIN, e as caixas deste usuario misturam
 * portugues e ingles. Com o volume de uma caixa pessoal, `ILIKE` com
 * indice de trigram resolve — e, principalmente, acha "fornec" dentro de
 * "fornecedor" sem depender de stemming.
 *
 * A ressalva honesta: em centenas de milhares de mensagens isto fica lento.
 * Quando chegar la, a troca e por full-text + GIN, e o `toTsQuery` ja esta
 * escrito e testado para isso.
 */

export const SEARCH_LIMIT = 60;

export async function runSearch(userId: string, filtros: SearchFilters): Promise<SearchHit[]> {
  if (!isRunnable(filtros)) return [];

  const termo = filtros.q.trim();
  const contem = { contains: termo, mode: 'insensitive' as const };

  const itens = await prisma.unifiedItem.findMany({
    where: {
      userId,
      ...(filtros.kind ? { kind: filtros.kind } : {}),
      ...(filtros.needsReply ? { triage: { needsReply: true } } : {}),
      ...(filtros.cobranca ? { triage: { category: 'COBRANCA' as const } } : {}),
      OR: [
        { title: contem },
        { preview: contem },
        { messages: { some: { fromEmail: contem } } },
        { messages: { some: { fromName: contem } } },
        { messages: { some: { subject: contem } } },
      ],
      ...(filtros.connectionId
        ? { messages: { some: { connectionId: filtros.connectionId } } }
        : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: SEARCH_LIMIT,
    select: {
      id: true,
      kind: true,
      title: true,
      preview: true,
      occurredAt: true,
      copyCount: true,
      triage: { select: { category: true, needsReply: true } },
      messages: {
        take: 1,
        orderBy: { receivedAt: 'desc' },
        select: {
          fromName: true,
          fromEmail: true,
          connection: { select: { accountEmail: true, displayName: true, color: true } },
        },
      },
    },
  });

  return itens.map((item) => {
    const mensagem = item.messages[0];
    return {
      unifiedItemId: item.id,
      kind: item.kind,
      title: item.title ?? '(sem assunto)',
      preview: item.preview,
      occurredAt: item.occurredAt,
      copyCount: item.copyCount,
      connectionLabel:
        mensagem?.connection.displayName ?? mensagem?.connection.accountEmail ?? '—',
      connectionColor: mensagem?.connection.color ?? '#888',
      fromLabel: mensagem?.fromName ?? mensagem?.fromEmail ?? null,
      category: item.triage?.category ?? null,
      needsReply: item.triage?.needsReply ?? false,
    };
  });
}

export { toTsQuery };
