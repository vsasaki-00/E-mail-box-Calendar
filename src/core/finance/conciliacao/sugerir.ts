import { prisma } from '@/lib/db';
import { escolherPares, type CobrancaParaConciliar, type LancamentoParaConciliar } from './pontuar';

/**
 * Procura pares e grava como SUGESTAO. Nunca confirma.
 *
 * Quem entra:
 *  - saidas do extrato ainda sem decisao sua (NONE ou SUGGESTED — a
 *    sugestao antiga e refeita, porque uma cobranca nova pode ser par
 *    melhor). CONFIRMED e REJECTED sao suas e ficam quietas.
 *  - cobrancas pagaveis, com valor, nao ignoradas, e que ainda nao tem
 *    lancamento confirmado.
 *
 * Janela: lancamentos dos ultimos 120 dias. Cobranca de tres meses atras
 * paga hoje e improvavel e, se acontecer, o par manual resolve.
 */

export interface ResultadoSugestao {
  lancamentosAvaliados: number;
  cobrancasAvaliadas: number;
  sugeridos: number;
  /** Sugestoes anteriores que nao acharam par desta vez e foram limpas. */
  limpas: number;
}

const JANELA_DIAS = 120;

export async function sugerirPares(userId: string): Promise<ResultadoSugestao> {
  const desde = new Date(Date.now() - JANELA_DIAS * 24 * 3600 * 1000);

  const [lancamentos, cobrancas, confirmadas] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        userId,
        amountCents: { lt: 0 },
        matchStatus: { in: ['NONE', 'SUGGESTED'] },
        postedAt: { gte: desde },
      },
      select: { id: true, postedAt: true, amountCents: true, description: true, normalized: true },
    }),
    prisma.billExtraction.findMany({
      where: { userId, isPayable: true, status: { not: 'IGNORED' }, amountCents: { not: null } },
      select: {
        id: true,
        amountCents: true,
        dueDate: true,
        payee: true,
        kind: true,
        unifiedItem: { select: { occurredAt: true } },
      },
    }),
    prisma.ledgerEntry.findMany({
      where: { userId, matchStatus: 'CONFIRMED', matchedBillId: { not: null } },
      select: { matchedBillId: true },
    }),
  ]);

  const jaCasadas = new Set(confirmadas.map((c) => c.matchedBillId));
  const candidatas: CobrancaParaConciliar[] = cobrancas
    .filter((c) => !jaCasadas.has(c.id))
    .map((c) => ({
      id: c.id,
      amountCents: c.amountCents ?? 0,
      dueDate: c.dueDate,
      receivedAt: c.unifiedItem.occurredAt,
      payee: c.payee,
      kind: c.kind,
    }));

  const pares = escolherPares(lancamentos as LancamentoParaConciliar[], candidatas);
  const sugeridosIds = new Set(pares.map((p) => p.lancamentoId));

  // Sugestao antiga que nao se sustentou: volta para NONE, para nao ficar
  // na tela apontando para uma cobranca que ja casou com outro lancamento.
  const paraLimpar = lancamentos.filter((l) => !sugeridosIds.has(l.id)).map((l) => l.id);

  await prisma.$transaction([
    ...pares.map((p) =>
      prisma.ledgerEntry.update({
        where: { id: p.lancamentoId },
        data: {
          matchStatus: 'SUGGESTED',
          matchedBillId: p.cobrancaId,
          matchConfidence: p.confianca,
          matchReason: p.motivo,
        },
      }),
    ),
    ...(paraLimpar.length > 0
      ? [
          prisma.ledgerEntry.updateMany({
            where: { id: { in: paraLimpar }, matchStatus: 'SUGGESTED' },
            data: { matchStatus: 'NONE', matchedBillId: null, matchConfidence: null, matchReason: null },
          }),
        ]
      : []),
  ]);

  const limpas = lancamentos.filter((l) => !sugeridosIds.has(l.id) && paraLimpar.includes(l.id)).length;

  return {
    lancamentosAvaliados: lancamentos.length,
    cobrancasAvaliadas: candidatas.length,
    sugeridos: pares.length,
    limpas,
  };
}
