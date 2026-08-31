import type { Connection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bestBodyText } from '@/core/voice/body-text';
import { keyringFromEnv } from '@/lib/crypto';
import { buildContext } from '@/core/sync/engine';
import { getConnector } from '@/lib/connectors/registry';
import {
  BILL_PROMPT_VERSION,
  createAnthropicBillModel,
  runBillExtraction,
  type BillModel,
} from './extractor';
import type { BillExtraction, BillInput } from './types';

/**
 * Liga a extracao financeira ao banco. Ver docs/07-agente-de-triagem.md
 *
 * PRIVACIDADE — esta e a fase onde o corpo do e-mail passa a ser lido, e
 * vale ser explicito sobre o escopo:
 *  - so mensagens que a 5A ja classificou como COBRANCA;
 *  - so os primeiros milhares de caracteres;
 *  - e boa parte nem chega ao modelo, porque o boleto e o PIX sao
 *    resolvidos localmente.
 * Isso e o "corpo sob demanda" que voce escolheu, nao uma ampliacao dele.
 */

/** Quantas cobrancas por execucao. */
export const MAX_BILLS_PER_RUN = 60;
/** Corpos buscados do provedor por execucao. */
export const MAX_BODY_FETCHES = 40;
const FETCH_CONCURRENCY = 4;

async function emLotes<T, R>(itens: T[], tamanho: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  }
  return saida;
}

export interface BillRunSummary {
  connectionId: string;
  accountEmail: string;
  /** Cobrancas encontradas pela triagem, ainda sem extracao. */
  found: number;
  fetched: number;
  fetchErrors: number;
  extracted: number;
  /** Quantas nao dependeram do modelo para valor/vencimento. */
  withInstrument: number;
  modelFailures: number;
  skippedUserOverride: number;
  error?: string;
}

/**
 * Roda a extracao financeira de uma conexao.
 *
 * `model` opcional: sem `ANTHROPIC_API_KEY` a extracao ainda roda e ainda
 * entrega boleto e PIX. Um painel que so funciona com chave seria pior do
 * que um painel parcial e honesto.
 *
 * Nunca lanca: uma caixa com problema nao impede as outras.
 */
export async function extractBillsForConnection(
  connection: Connection,
  userId: string,
  model?: BillModel | null,
  hoje = new Date(),
): Promise<BillRunSummary> {
  const base = { connectionId: connection.id, accountEmail: connection.accountEmail };
  const vazio = {
    found: 0, fetched: 0, fetchErrors: 0, extracted: 0,
    withInstrument: 0, modelFailures: 0, skippedUserOverride: 0,
  };

  try {
    // So o que a triagem ja marcou como COBRANCA. E aqui que o escopo da
    // leitura de corpo fica limitado, na consulta.
    const mensagens = await prisma.message.findMany({
      where: {
        connectionId: connection.id,
        unifiedItem: { userId, triage: { category: 'COBRANCA' }, bill: null },
      },
      orderBy: { receivedAt: 'desc' },
      take: MAX_BILLS_PER_RUN,
      select: {
        id: true,
        providerId: true,
        unifiedItemId: true,
        fromEmail: true,
        fromName: true,
        subject: true,
        receivedAt: true,
        hasAttachments: true,
        bodyText: true,
        bodyHtml: true,
      },
    });

    if (mensagens.length === 0) return { ...base, ...vazio };

    const semCorpo = mensagens.filter((m) => !m.bodyText && !m.bodyHtml).slice(0, MAX_BODY_FETCHES);
    let fetched = 0;
    let fetchErrors = 0;

    if (semCorpo.length > 0) {
      const conector = getConnector(connection.provider);
      const contexto = buildContext(connection, keyringFromEnv());

      await emLotes(semCorpo, FETCH_CONCURRENCY, async (mensagem) => {
        try {
          const corpo = await conector.fetchMessageBody(contexto, mensagem.providerId);
          await prisma.message.update({
            where: { id: mensagem.id },
            data: {
              bodyText: corpo.text ?? null,
              bodyHtml: corpo.html ?? null,
              bodyFetchedAt: new Date(),
            },
          });
          mensagem.bodyText = corpo.text ?? null;
          mensagem.bodyHtml = corpo.html ?? null;
          fetched += 1;
        } catch {
          fetchErrors += 1;
        }
      });
    }

    const inputs: BillInput[] = mensagens
      .filter((m): m is typeof m & { unifiedItemId: string } => m.unifiedItemId !== null)
      .map((m) => ({
        id: m.unifiedItemId,
        fromEmail: m.fromEmail,
        fromName: m.fromName,
        subject: m.subject,
        body: bestBodyText({ text: m.bodyText, html: m.bodyHtml }),
        receivedAt: m.receivedAt,
        hasAttachments: m.hasAttachments,
      }));

    const modelo = model === undefined ? criarModeloSeHouverChave() : model;
    const execucao = await runBillExtraction(inputs, modelo, hoje);
    const gravacao = await persistBillExtractions(execucao.extractions, userId, modelo?.name ?? null);

    return {
      ...base,
      found: mensagens.length,
      fetched,
      fetchErrors,
      extracted: gravacao.created + gravacao.updated,
      withInstrument: execucao.withInstrument,
      modelFailures: execucao.modelFailures.length,
      skippedUserOverride: gravacao.skippedUserOverride,
    };
  } catch (erro) {
    return { ...base, ...vazio, error: erro instanceof Error ? erro.message : String(erro) };
  }
}

/** Sem chave configurada a extracao roda so com a camada deterministica. */
function criarModeloSeHouverChave(): BillModel | null {
  return process.env.ANTHROPIC_API_KEY ? createAnthropicBillModel() : null;
}

/**
 * Grava as extracoes.
 *
 * Mesma regra da triagem: uma linha com `source: 'USER'` nunca e
 * sobrescrita. E o status (`PENDING`/`PAID`/`IGNORED`) tambem nao — ele e
 * do usuario, e reextrair nao pode "despagar" uma conta.
 */
export async function persistBillExtractions(
  extractions: BillExtraction[],
  userId: string,
  modelName: string | null,
): Promise<{ created: number; updated: number; skippedUserOverride: number }> {
  let created = 0;
  let updated = 0;
  let skippedUserOverride = 0;

  for (const e of extractions) {
    const existente = await prisma.billExtraction.findUnique({
      where: { unifiedItemId: e.id },
      select: { id: true, source: true },
    });

    if (existente?.source === 'USER') {
      skippedUserOverride += 1;
      continue;
    }

    const dados = {
      amountCents: e.amountCents,
      currency: e.currency,
      dueDate: e.dueDate,
      payee: e.payee,
      kind: e.kind,
      digitableLine: e.digitableLine,
      pixPayload: e.pixPayload,
      pixKey: e.pixKey,
      confidence: e.confidence,
      source: e.source,
      reason: e.reason,
      warnings: e.warnings,
      isPayable: e.isPayable,
      model: e.source === 'MODEL' ? modelName : null,
      promptVersion: e.source === 'MODEL' ? BILL_PROMPT_VERSION : null,
      extractedAt: new Date(),
    };

    if (existente) {
      // `status` fica de fora do update de proposito: reextrair nao pode
      // desfazer o "paguei" que voce marcou.
      await prisma.billExtraction.update({ where: { id: existente.id }, data: dados });
      updated += 1;
    } else {
      await prisma.billExtraction.create({ data: { unifiedItemId: e.id, userId, ...dados } });
      created += 1;
    }
  }

  return { created, updated, skippedUserOverride };
}

/** Marca o estado da cobranca. Sempre acao do usuario, nunca do agente. */
export async function setBillStatus(
  unifiedItemId: string,
  status: 'PENDING' | 'PAID' | 'IGNORED',
): Promise<void> {
  await prisma.billExtraction.update({ where: { unifiedItemId }, data: { status } });
}

/** Correcao manual de valor/vencimento. Blinda a linha contra reextracao. */
export async function correctBill(params: {
  unifiedItemId: string;
  amountCents?: number | null;
  dueDate?: Date | null;
  payee?: string | null;
  userNotes?: string;
}): Promise<void> {
  const atual = await prisma.billExtraction.findUnique({
    where: { unifiedItemId: params.unifiedItemId },
  });
  if (!atual) throw new Error('Cobrança não encontrada');

  await prisma.billExtraction.update({
    where: { id: atual.id },
    data: {
      amountCents: params.amountCents !== undefined ? params.amountCents : atual.amountCents,
      dueDate: params.dueDate !== undefined ? params.dueDate : atual.dueDate,
      payee: params.payee !== undefined ? params.payee : atual.payee,
      userNotes: params.userNotes?.trim() || atual.userNotes,
      confidence: 1,
      source: 'USER',
      reason: 'Corrigido por você',
      // A correcao resolve os avisos: voce olhou o e-mail original.
      warnings: [],
    },
  });
}
