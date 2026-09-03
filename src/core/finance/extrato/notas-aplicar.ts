import { prisma } from '@/lib/db';
import { casarNotas, textoDaColagem, type LinhaDoExtrato, type NotaEsperando } from './notas';

/**
 * Cola as notas que esperavam o extrato. Ver docs/10-financeiro.md
 *
 * Roda depois de uma importação. Não cria dinheiro: só escreve o
 * significado (negócio, categoria, o que era) numa linha que o banco já
 * confirmou.
 *
 * Só o casamento inequívoco cola — a regra vive em `notas.ts`, pura. Nota
 * que ficou em empate continua esperando, que é o estado em que ela já
 * estava.
 */
export async function aplicarNotasPendentes(
  userId: string,
  statementId: string,
): Promise<{ coladas: number }> {
  const [pendentes, linhas] = await Promise.all([
    prisma.inboxMessage.findMany({
      where: { userId, status: 'WAITING_STATEMENT', proposedAmountCents: { not: null } },
      select: {
        id: true,
        proposedAmountCents: true,
        proposedDirection: true,
        proposedDate: true,
        proposedDescription: true,
        proposedBusiness: true,
        proposedCategory: true,
        receivedAt: true,
      },
    }),
    prisma.ledgerEntry.findMany({
      where: { userId, statementId },
      select: { id: true, amountCents: true, postedAt: true },
    }),
  ]);
  if (pendentes.length === 0 || linhas.length === 0) return { coladas: 0 };

  const notas: NotaEsperando[] = pendentes.map((p) => ({
    id: p.id,
    amountCents: Math.abs(p.proposedAmountCents!),
    direcao: p.proposedDirection === 'ENTRADA' ? 'ENTRADA' : 'SAIDA',
    quando: p.proposedDate ?? p.receivedAt,
    descricao: p.proposedDescription ?? undefined,
    business: p.proposedBusiness ?? undefined,
    category: p.proposedCategory ?? undefined,
  }));

  const colagens = casarNotas(notas, linhas as LinhaDoExtrato[]);
  if (colagens.length === 0) return { coladas: 0 };

  const porId = new Map(notas.map((n) => [n.id, n]));

  await prisma.$transaction(
    colagens.flatMap((c) => {
      const nota = porId.get(c.notaId)!;
      return [
        prisma.ledgerEntry.updateMany({
          where: { id: c.lancamentoId, userId },
          data: {
            ...(c.business ? { business: c.business } : {}),
            // `USER` porque a categoria veio de VOCÊ, na hora em que
            // aconteceu — não é palpite de regra nem de heurística, e nada
            // pode sobrescrevê-la depois.
            ...(c.category ? { category: c.category, categorySource: 'USER' } : {}),
            notes: textoDaColagem(c.descricao, nota.quando),
          },
        }),
        prisma.inboxMessage.updateMany({
          where: { id: c.notaId, userId },
          data: { status: 'ACCEPTED', ledgerEntryId: c.lancamentoId },
        }),
      ];
    }),
  );

  return { coladas: colagens.length };
}
