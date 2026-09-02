import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { interpretarTexto } from './mensagem';
import { categoriaHeuristica } from '@/core/finance/categorias';
import { normalizarDescricao } from '@/core/finance/extrato/normalizar';
import { isBusinessContext } from '@/core/triage/businesses';
import { isCategoria } from '@/core/finance/categorias';

/**
 * Da mensagem recebida à proposta, e da proposta ao lançamento.
 * Ver docs/11-whatsapp.md
 *
 * Duas etapas separadas de propósito: registrar o que chegou nunca falha
 * por causa da interpretação, e interpretar nunca cria lançamento. Só o
 * seu clique cria.
 */

export interface MensagemRecebida {
  externalId: string;
  fromNumber: string;
  fromName?: string;
  kind: string;
  text?: string;
  mediaId?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  receivedAt: Date;
}

export type ResultadoRegistro =
  | { ok: true; id: string; duplicada: boolean }
  | { ok: false; erro: string };

/**
 * Grava a mensagem e propõe, numa transação por mensagem.
 *
 * Reentrega do webhook não duplica: a unique (channel, externalId) decide.
 * A Meta reentrega quando não recebe 200 — e recebe 200 mesmo quando a
 * mensagem é recusada, então "recusada" também precisa ser idempotente.
 */
export async function registrarMensagem(
  userId: string,
  msg: MensagemRecebida,
): Promise<ResultadoRegistro> {
  const existente = await prisma.inboxMessage.findUnique({
    where: { channel_externalId: { channel: 'WHATSAPP', externalId: msg.externalId } },
    select: { id: true },
  });
  if (existente) return { ok: true, id: existente.id, duplicada: true };

  const proposta = msg.text ? interpretarTexto(msg.text, msg.receivedAt) : undefined;

  // Mídia sem texto: registra e espera por você. Ler foto de comprovante
  // exigiria OCR, que este app não tem — e inventar valor a partir de uma
  // imagem seria pior que não ler.
  const semTexto = !msg.text?.trim();
  const dados: Prisma.InboxMessageUncheckedCreateInput = {
    userId,
    channel: 'WHATSAPP',
    externalId: msg.externalId,
    fromNumber: msg.fromNumber,
    fromName: msg.fromName ?? null,
    kind: msg.kind,
    text: msg.text ?? null,
    mediaId: msg.mediaId ?? null,
    mediaMimeType: msg.mediaMimeType ?? null,
    mediaFileName: msg.mediaFileName ?? null,
    receivedAt: msg.receivedAt,
    status: proposta?.amountCents ? 'PROPOSED' : 'FAILED',
    proposedAmountCents: proposta?.amountCents ?? null,
    proposedDirection: proposta?.direcao ?? null,
    proposedDescription: proposta?.descricao ?? null,
    proposedDate: proposta?.data ?? msg.receivedAt,
    proposedCategory: proposta?.descricao
      ? (categoriaHeuristica(normalizarDescricao(proposta.descricao), proposta.direcao === 'ENTRADA' ? 1 : -1) ?? null)
      : null,
    confidence: proposta?.confianca ?? 0,
    reason: proposta?.motivo ?? null,
    errorMessage: proposta?.amountCents
      ? null
      : semTexto
        ? 'Mídia sem legenda: não sei ler o valor de uma imagem. Escreva o valor numa mensagem, ou confira o arquivo no WhatsApp e lance à mão.'
        : 'Não achei um valor na mensagem.',
  };

  try {
    const criada = await prisma.inboxMessage.create({ data: dados, select: { id: true } });
    return { ok: true, id: criada.id, duplicada: false };
  } catch (erro) {
    // Corrida entre duas entregas da mesma mensagem: a unique resolveu, e
    // isso é sucesso, não falha.
    const outra = await prisma.inboxMessage.findUnique({
      where: { channel_externalId: { channel: 'WHATSAPP', externalId: msg.externalId } },
      select: { id: true },
    });
    if (outra) return { ok: true, id: outra.id, duplicada: true };
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

export interface AceitarParams {
  userId: string;
  mensagemId: string;
  accountId: string;
  amountCents: number;
  direcao: 'ENTRADA' | 'SAIDA';
  descricao: string;
  data: Date;
  category?: string;
  business?: string;
}

/** Você confirmou: vira lançamento de verdade, com a origem registrada. */
export async function aceitarProposta(
  params: AceitarParams,
): Promise<{ ok: true; ledgerEntryId: string } | { ok: false; erro: string }> {
  const [msg, conta] = await Promise.all([
    prisma.inboxMessage.findFirst({
      where: { id: params.mensagemId, userId: params.userId },
      select: { id: true, status: true, externalId: true },
    }),
    prisma.financialAccount.findFirst({
      where: { id: params.accountId, userId: params.userId },
      select: { id: true, business: true },
    }),
  ]);
  if (!msg) return { ok: false, erro: 'Mensagem não encontrada' };
  if (!conta) return { ok: false, erro: 'Conta não encontrada' };
  if (msg.status === 'ACCEPTED') return { ok: false, erro: 'Esta mensagem já virou lançamento' };
  if (!Number.isFinite(params.amountCents) || params.amountCents <= 0) {
    return { ok: false, erro: 'Valor inválido' };
  }
  if (params.category && !isCategoria(params.category)) return { ok: false, erro: 'Categoria inválida' };
  if (params.business && !isBusinessContext(params.business)) return { ok: false, erro: 'Negócio inválido' };

  const descricao = params.descricao.trim() || '(sem descrição)';
  const assinado = params.direcao === 'SAIDA' ? -Math.abs(params.amountCents) : Math.abs(params.amountCents);

  try {
    const criado = await prisma.$transaction(async (tx) => {
      const entrada = await tx.ledgerEntry.create({
        data: {
          userId: params.userId,
          accountId: conta.id,
          postedAt: params.data,
          amountCents: assinado,
          description: descricao,
          normalized: normalizarDescricao(descricao),
          source: 'MANUAL',
          // A impressão digital carrega a origem: um lançamento vindo do
          // WhatsApp não pode colidir com um do extrato do mesmo dia e
          // valor, nem ser criado duas vezes por dois cliques.
          fingerprint: `whatsapp:${msg.externalId}`,
          category: params.category ?? null,
          categorySource: params.category ? 'USER' : null,
          business: params.business ?? conta.business,
          notes: 'Lançado a partir de uma mensagem de WhatsApp',
        },
        select: { id: true },
      });
      await tx.inboxMessage.update({
        where: { id: msg.id },
        data: { status: 'ACCEPTED', ledgerEntryId: entrada.id },
      });
      return entrada.id;
    });
    return { ok: true, ledgerEntryId: criado };
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : String(erro);
    if (texto.includes('Unique constraint') || texto.includes('fingerprint')) {
      return { ok: false, erro: 'Esta mensagem já tem um lançamento nesta conta.' };
    }
    return { ok: false, erro: texto };
  }
}

/** "Não é lançamento". A mensagem some da fila e não volta. */
export async function rejeitarMensagem(userId: string, mensagemId: string): Promise<void> {
  await prisma.inboxMessage.updateMany({
    where: { id: mensagemId, userId, status: { not: 'ACCEPTED' } },
    data: { status: 'REJECTED' },
  });
}
