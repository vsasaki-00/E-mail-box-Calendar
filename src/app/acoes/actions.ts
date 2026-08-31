'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { cancelAction, executeAction, undoAction } from '@/core/actions/execute';

/** Server Actions da fila de ações (fase 4). Ver docs/08-escrita-e-acoes.md */

export interface AcaoResultado {
  ok: boolean;
  mensagem?: string;
  erro?: string;
}

async function donoAtual(): Promise<string | null> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  return usuario?.id ?? null;
}

/**
 * Confirmar e executar.
 *
 * `explicitlyConfirmed: true` porque o clique NESTE botão é a confirmação
 * — e é ele que libera uma ação irreversível. Um botão genérico de
 * "executar tudo" não passaria por aqui de propósito.
 */
export async function confirmarEExecutar(
  actionId: string,
  _anterior: AcaoResultado | null,
): Promise<AcaoResultado> {
  const userId = await donoAtual();
  if (!userId) return { ok: false, erro: 'Nenhum usuário' };

  // O rascunho ligado à ação precisa estar aprovado por você; a trava da
  // fase 5D continua valendo depois que a escrita existe.
  const acao = await prisma.actionRequest.findFirst({
    where: { id: actionId, userId },
    select: { kind: true, unifiedItemId: true },
  });
  let draftApproved: boolean | undefined;
  if (acao?.kind === 'SEND_REPLY' && acao.unifiedItemId) {
    const rascunho = await prisma.draft.findUnique({
      where: { unifiedItemId: acao.unifiedItemId },
      select: { status: true },
    });
    draftApproved = rascunho?.status === 'APPROVED';
  }

  const resultado = await executeAction(actionId, userId, {
    explicitlyConfirmed: true,
    draftApproved,
  });
  revalidatePath('/acoes');

  if (!resultado.ok) return { ok: false, erro: resultado.error ?? 'Falhou' };
  return { ok: true, mensagem: 'Feito.' };
}

export async function desfazer(actionId: string, _anterior: AcaoResultado | null): Promise<AcaoResultado> {
  const userId = await donoAtual();
  if (!userId) return { ok: false, erro: 'Nenhum usuário' };

  const resultado = await undoAction(actionId, userId);
  revalidatePath('/acoes');

  if (!resultado.ok) return { ok: false, erro: resultado.error ?? 'Falhou' };
  return { ok: true, mensagem: 'Desfeito.' };
}

export async function cancelar(actionId: string): Promise<void> {
  const userId = await donoAtual();
  if (!userId) return;
  await cancelAction(actionId, userId);
  revalidatePath('/acoes');
}
