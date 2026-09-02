import { prisma } from '@/lib/db';

/**
 * As tres decisoes que sao SUAS sobre um par. Nada aqui roda sozinho.
 *
 * Confirmar marca a cobranca como PAGA. Isso nao contradiz "o agente nunca
 * marca como paga": quem clicou foi voce, e o pagamento esta no extrato.
 * E a unica forma de "paguei" virar "paguei, dia tal, desta conta".
 */

export async function confirmarPar(userId: string, lancamentoId: string): Promise<void> {
  const l = await prisma.ledgerEntry.findFirst({
    where: { id: lancamentoId, userId },
    select: { id: true, matchedBillId: true, matchStatus: true },
  });
  if (!l || !l.matchedBillId) throw new Error('Lançamento sem sugestão para confirmar');
  if (l.matchStatus === 'CONFIRMED') return;

  await prisma.$transaction([
    prisma.ledgerEntry.update({ where: { id: l.id }, data: { matchStatus: 'CONFIRMED' } }),
    prisma.billExtraction.update({
      where: { id: l.matchedBillId },
      data: { status: 'PAID' },
    }),
  ]);
}

/** "Nao e isto": a sugestao sai e este lancamento nao recebe outra. */
export async function rejeitarPar(userId: string, lancamentoId: string): Promise<void> {
  await prisma.ledgerEntry.updateMany({
    where: { id: lancamentoId, userId },
    data: { matchStatus: 'REJECTED', matchConfidence: null, matchReason: 'Você disse que não é esta cobrança' },
  });
}

/** Desfaz confirmacao ou rejeicao: volta a ser candidato. */
export async function desfazerDecisao(userId: string, lancamentoId: string): Promise<void> {
  const l = await prisma.ledgerEntry.findFirst({
    where: { id: lancamentoId, userId },
    select: { id: true, matchedBillId: true, matchStatus: true },
  });
  if (!l) return;

  await prisma.$transaction([
    prisma.ledgerEntry.update({
      where: { id: l.id },
      data: { matchStatus: 'NONE', matchedBillId: null, matchConfidence: null, matchReason: null },
    }),
    // A cobranca volta a pendente so se era ESTA confirmacao que a pagava.
    ...(l.matchStatus === 'CONFIRMED' && l.matchedBillId
      ? [prisma.billExtraction.update({ where: { id: l.matchedBillId }, data: { status: 'PENDING' } })]
      : []),
  ]);
}

/** Par manual: voce escolheu a cobranca. Confirmado na hora. */
export async function casarManualmente(userId: string, lancamentoId: string, cobrancaId: string): Promise<void> {
  const [l, c] = await Promise.all([
    prisma.ledgerEntry.findFirst({ where: { id: lancamentoId, userId }, select: { id: true } }),
    prisma.billExtraction.findFirst({ where: { id: cobrancaId, userId }, select: { id: true } }),
  ]);
  if (!l || !c) throw new Error('Lançamento ou cobrança não encontrados');

  await prisma.$transaction([
    prisma.ledgerEntry.update({
      where: { id: l.id },
      data: { matchStatus: 'CONFIRMED', matchedBillId: c.id, matchConfidence: 1, matchReason: 'Par escolhido por você' },
    }),
    prisma.billExtraction.update({ where: { id: c.id }, data: { status: 'PAID' } }),
  ]);
}
