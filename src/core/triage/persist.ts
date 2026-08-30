import type { Connection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createAnthropicTriageModel, runTriage, PROMPT_VERSION, type TriageModel } from './classifier';
import type { MailboxContext, TriageInput, TriageResult } from './types';

/**
 * Liga a triagem ao banco. Ver docs/07-agente-de-triagem.md
 *
 * Duas regras que nao podem ser quebradas:
 *  - uma classificacao do USUARIO nunca e sobrescrita por regra ou modelo;
 *  - o corpo da mensagem nunca sai daqui para o classificador — o
 *    `TriageInput` montado abaixo carrega apenas metadados, por construcao.
 */

/** Constroi o contexto da caixa a partir do perfil salvo (ou dos defaults). */
export async function loadMailboxContext(connection: Connection): Promise<MailboxContext> {
  const perfil = await prisma.mailboxProfile.findUnique({
    where: { connectionId: connection.id },
  });

  return {
    businessName: perfil?.businessName ?? connection.displayName,
    role: perfil?.role ?? null,
    objective: perfil?.objective ?? null,
    calibration: perfil?.calibration ?? 'BALANCED',
    vipSenders: Array.isArray(perfil?.vipSenders) ? (perfil.vipSenders as string[]) : [],
    urgentKeywords: Array.isArray(perfil?.urgentKeywords) ? (perfil.urgentKeywords as string[]) : [],
    accountEmail: connection.accountEmail,
  };
}

/**
 * Busca itens ainda sem triagem de uma conexao.
 *
 * `select` explicito, sem `bodyText`/`bodyHtml`: a garantia de privacidade
 * comeca aqui, na consulta — nao ha como o corpo vazar para o prompt se ele
 * nunca e lido do banco.
 */
export async function loadUntriagedInputs(
  connectionId: string,
  userId: string,
  limit = 200,
): Promise<TriageInput[]> {
  const mensagens = await prisma.message.findMany({
    where: {
      connectionId,
      unifiedItem: { userId, triage: null },
      mailbox: { includeInUnified: true },
    },
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: {
      unifiedItemId: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      snippet: true,
      receivedAt: true,
      hasAttachments: true,
      toEmails: true,
      ccEmails: true,
      connection: { select: { accountEmail: true } },
    },
  });

  return mensagens
    .filter((m): m is typeof m & { unifiedItemId: string } => m.unifiedItemId !== null)
    .map((m) => {
      const to = Array.isArray(m.toEmails) ? (m.toEmails as string[]) : [];
      const cc = Array.isArray(m.ccEmails) ? (m.ccEmails as string[]) : [];
      const meu = m.connection.accountEmail.toLowerCase();

      return {
        id: m.unifiedItemId,
        fromEmail: m.fromEmail,
        fromName: m.fromName,
        subject: m.subject,
        snippet: m.snippet,
        receivedAt: m.receivedAt,
        hasAttachments: m.hasAttachments,
        isDirectRecipient: to.some((e) => e.toLowerCase() === meu),
        recipientCount: to.length + cc.length,
      };
    });
}

/**
 * Grava resultados. `upsert` que respeita a precedencia do usuario: uma
 * linha com `source: 'USER'` nunca e sobrescrita.
 */
export async function persistTriageResults(
  results: TriageResult[],
  userId: string,
  modelName: string,
): Promise<{ created: number; updated: number; skippedUserOverride: number }> {
  let created = 0;
  let updated = 0;
  let skippedUserOverride = 0;

  for (const resultado of results) {
    const existente = await prisma.itemTriage.findUnique({
      where: { unifiedItemId: resultado.id },
      select: { id: true, source: true },
    });

    if (existente?.source === 'USER') {
      skippedUserOverride += 1;
      continue;
    }

    const dados = {
      category: resultado.category,
      priority: resultado.priority,
      needsReply: resultado.needsReply,
      confidence: resultado.confidence,
      reason: resultado.reason,
      source: resultado.source,
      // Regra deterministica nao consome modelo: registrar um nome ali
      // faria a contabilidade de custo mentir.
      model: resultado.source === 'MODEL' ? modelName : null,
      promptVersion: resultado.source === 'MODEL' ? PROMPT_VERSION : null,
    };

    if (existente) {
      await prisma.itemTriage.update({ where: { id: existente.id }, data: dados });
      updated += 1;
    } else {
      await prisma.itemTriage.create({
        data: { unifiedItemId: resultado.id, userId, ...dados },
      });
      created += 1;
    }
  }

  return { created, updated, skippedUserOverride };
}

export interface TriageConnectionSummary {
  connectionId: string;
  accountEmail: string;
  processed: number;
  decidedByRule: number;
  decidedByModel: number;
  missing: number;
  skippedUserOverride: number;
  error?: string;
}

/**
 * Roda a triagem de uma conexao ponta a ponta.
 *
 * Nunca lanca: uma conexao com problema nao pode impedir as outras de serem
 * triadas — mesma degradacao por conexao do motor de sync.
 */
export async function triageConnection(
  connection: Connection,
  userId: string,
  model?: TriageModel,
): Promise<TriageConnectionSummary> {
  const base = { connectionId: connection.id, accountEmail: connection.accountEmail };

  try {
    const inputs = await loadUntriagedInputs(connection.id, userId);
    if (inputs.length === 0) {
      return { ...base, processed: 0, decidedByRule: 0, decidedByModel: 0, missing: 0, skippedUserOverride: 0 };
    }

    const contexto = await loadMailboxContext(connection);
    const modelo = model ?? createAnthropicTriageModel();
    const execucao = await runTriage(inputs, contexto, modelo);
    const gravacao = await persistTriageResults(execucao.results, userId, modelo.name);

    return {
      ...base,
      processed: execucao.results.length,
      decidedByRule: execucao.decidedByRule,
      decidedByModel: execucao.decidedByModel,
      missing: execucao.missing.length,
      skippedUserOverride: gravacao.skippedUserOverride,
    };
  } catch (erro) {
    return {
      ...base,
      processed: 0,
      decidedByRule: 0,
      decidedByModel: 0,
      missing: 0,
      skippedUserOverride: 0,
      error: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

/** Registra a correcao do usuario e marca a triagem como decidida por ele. */
export async function applyUserCorrection(params: {
  unifiedItemId: string;
  userId: string;
  category?: TriageResult['category'];
  priority?: TriageResult['priority'];
  needsReply?: boolean;
  note?: string;
}): Promise<void> {
  const atual = await prisma.itemTriage.findUnique({
    where: { unifiedItemId: params.unifiedItemId },
  });
  if (!atual) throw new Error('Item sem triagem para corrigir');

  await prisma.$transaction([
    prisma.itemTriage.update({
      where: { id: atual.id },
      data: {
        category: params.category ?? atual.category,
        priority: params.priority ?? atual.priority,
        needsReply: params.needsReply ?? atual.needsReply,
        // A correcao do usuario tem confianca maxima e blinda a linha
        // contra reclassificacao futura.
        confidence: 1,
        source: 'USER',
        reason: params.note ?? 'Corrigido por você',
      },
    }),
    prisma.triageFeedback.create({
      data: {
        itemTriageId: atual.id,
        userId: params.userId,
        fromCategory: atual.category,
        toCategory: params.category ?? atual.category,
        fromPriority: atual.priority,
        toPriority: params.priority ?? atual.priority,
        note: params.note,
      },
    }),
  ]);
}
