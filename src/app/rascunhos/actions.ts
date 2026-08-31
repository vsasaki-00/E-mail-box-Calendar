'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import {
  approveDraft,
  discardDraft,
  requestDraft,
  saveDraftEdit,
} from '@/core/draft/persist';

/** Server Actions da tela de rascunhos (fase 5D). Nenhuma delas envia e-mail. */

export interface AcaoResultado {
  ok: boolean;
  mensagem?: string;
  erro?: string;
}

export async function gerarRascunho(
  unifiedItemId: string,
  _anterior: AcaoResultado | null,
  form: FormData,
): Promise<AcaoResultado> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Nenhum usuário' };

  const resultado = await requestDraft(
    unifiedItemId,
    usuario.id,
    String(form.get('direction') ?? '').trim() || null,
  );
  revalidatePath('/rascunhos');

  // A recusa e um resultado legitimo, e o motivo importa mais do que o
  // "falhou": e ele que diz o que fazer para destravar.
  if (resultado.refusal) return { ok: false, erro: resultado.refusal.message };
  if (!resultado.ok) return { ok: false, erro: resultado.error ?? 'Não foi possível gerar' };

  return { ok: true, mensagem: 'Rascunho gerado. Nada foi enviado.' };
}

export async function salvarEdicao(
  unifiedItemId: string,
  _anterior: AcaoResultado | null,
  form: FormData,
): Promise<AcaoResultado> {
  const texto = String(form.get('bodyEdited') ?? '');
  if (!texto.trim()) return { ok: false, erro: 'Texto vazio' };

  await saveDraftEdit(unifiedItemId, texto);
  revalidatePath('/rascunhos');
  return { ok: true, mensagem: 'Sua versão foi salva.' };
}

export async function aprovar(unifiedItemId: string): Promise<void> {
  await approveDraft(unifiedItemId);
  revalidatePath('/rascunhos');
}

export async function descartar(unifiedItemId: string): Promise<void> {
  await discardDraft(unifiedItemId);
  revalidatePath('/rascunhos');
}
