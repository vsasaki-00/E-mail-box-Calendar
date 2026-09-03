import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { interpretarTexto } from './mensagem';
import { categoriaHeuristica } from '@/core/finance/categorias';
import { normalizarDescricao } from '@/core/finance/extrato/normalizar';
import { negocioValido } from '@/core/triage/negocios-dados';
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
  if (params.business && !(await negocioValido(params.userId, params.business))) {
    return { ok: false, erro: 'Negócio inválido' };
  }

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

/**
 * O contexto que a resposta do WhatsApp carrega. Ver docs/11-whatsapp.md
 *
 * Três consultas curtas, todas dentro do webhook: um `<Message>` que chega
 * um minuto depois não serve para nada. Se qualquer uma falhar, a resposta
 * sai sem aquele pedaço — informação a menos é melhor que resposta nenhuma.
 */
export async function contextoDaResposta(
  userId: string,
  mensagemId: string,
  proposta: { amountCents?: number; descricao?: string; data?: Date },
  agora = new Date(),
): Promise<{
  parecido?: { quando: Date; descricao: string };
  aVencer?: { quantas: number; totalCents: number; dias: number };
  outrasPendentes: number;
}> {
  const DIAS_A_VENCER = 7;
  const limite = new Date(agora.getTime() + DIAS_A_VENCER * 864e5);

  const [parecidos, cobrancas, outrasPendentes] = await Promise.all([
    // Mesmo valor, nos últimos 30 dias. Valor igual é o sinal barato e
    // preciso: descrição a pessoa digita diferente toda vez, valor não.
    proposta.amountCents
      ? prisma.ledgerEntry.findMany({
          where: {
            userId,
            amountCents: { in: [proposta.amountCents, -proposta.amountCents] },
            postedAt: { gte: new Date(agora.getTime() - 30 * 864e5) },
          },
          orderBy: { postedAt: 'desc' },
          take: 5,
          select: { postedAt: true, description: true, normalized: true },
        })
      : Promise.resolve([]),
    prisma.billExtraction.findMany({
      where: {
        userId,
        status: 'PENDING',
        isPayable: true,
        dueDate: { gte: agora, lte: limite },
        amountCents: { not: null },
      },
      select: { amountCents: true },
    }),
    prisma.inboxMessage.count({
      where: { userId, status: { in: ['PENDING', 'PROPOSED'] }, id: { not: mensagemId } },
    }),
  ]);

  // Valor igual sozinho gera alarme falso demais (aluguel, mensalidade). Só
  // vira aviso quando a descrição também conversa — uma palavra de peso em
  // comum basta, porque "FORNECEDOR XYZ LTDA" e "fornecedor XYZ" são a
  // mesma coisa escrita por duas mãos.
  const alvo = new Set(
    normalizarDescricao(proposta.descricao ?? '')
      .split(' ')
      .filter((p) => p.length >= 4),
  );
  const parecido =
    alvo.size > 0
      ? parecidos.find((e) => e.normalized.split(' ').some((p) => alvo.has(p)))
      : undefined;

  return {
    parecido: parecido ? { quando: parecido.postedAt, descricao: parecido.description } : undefined,
    aVencer: {
      quantas: cobrancas.length,
      totalCents: cobrancas.reduce((s, c) => s + (c.amountCents ?? 0), 0),
      dias: DIAS_A_VENCER,
    },
    outrasPendentes,
  };
}

/**
 * Quanto tempo uma pergunta fica de pé.
 *
 * Uma hora depois, um `3` solto tem muito mais chance de ser uma despesa
 * nova do que a resposta esquecida de uma pergunta antiga. A janela erra
 * para o lado seguro: perder uma resposta custa repetir; tratar uma despesa
 * como resposta custa a despesa.
 */
export const JANELA_DA_PERGUNTA_MS = 60 * 60 * 1000;

/**
 * A proposta que está esperando você dizer o negócio, se houver.
 *
 * A mais recente daquele número, ainda pendente e sem negócio, dentro da
 * janela. Uma só: aplicar uma resposta a várias propostas seria adivinhar.
 */
export async function propostaEsperandoNegocio(
  userId: string,
  fromNumber: string,
  agora = new Date(),
) {
  return prisma.inboxMessage.findFirst({
    where: {
      userId,
      fromNumber,
      status: 'PROPOSED',
      proposedBusiness: null,
      receivedAt: { gte: new Date(agora.getTime() - JANELA_DA_PERGUNTA_MS) },
    },
    orderBy: { receivedAt: 'desc' },
    select: { id: true, proposedAmountCents: true, proposedDescription: true },
  });
}

/**
 * Grava a resposta e anota o negócio na proposta, numa transação.
 *
 * A mensagem é registrada como `REJECTED` — que é a verdade: um `3` não é
 * lançamento nenhum. Isso a mantém fora da fila da tela e faz a reentrega
 * do Twilio não reprocessar, pela mesma unique de sempre.
 */
export async function registrarEscolha(
  userId: string,
  msg: MensagemRecebida,
  propostaId: string,
  negocio: string,
): Promise<{ duplicada: boolean }> {
  const existente = await prisma.inboxMessage.findUnique({
    where: { channel_externalId: { channel: 'WHATSAPP', externalId: msg.externalId } },
    select: { id: true },
  });
  if (existente) return { duplicada: true };

  await prisma.$transaction([
    prisma.inboxMessage.create({
      data: {
        userId,
        channel: 'WHATSAPP',
        externalId: msg.externalId,
        fromNumber: msg.fromNumber,
        fromName: msg.fromName ?? null,
        kind: msg.kind,
        text: msg.text ?? null,
        receivedAt: msg.receivedAt,
        status: 'REJECTED',
        proposedDate: msg.receivedAt,
        confidence: 1,
        reason: `Resposta à pergunta de negócio: ${negocio}`,
      },
    }),
    prisma.inboxMessage.updateMany({
      // `updateMany` com o userId no filtro: um id sozinho viria da
      // mensagem, e mensagem é entrada de fora.
      where: { id: propostaId, userId },
      data: { proposedBusiness: negocio },
    }),
  ]);

  return { duplicada: false };
}
