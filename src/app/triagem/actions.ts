'use server';

import { revalidatePath } from 'next/cache';
import type { TriageCategory, TriagePriority } from '@prisma/client';
import { prisma } from '@/lib/db';
import { applyUserCorrection } from '@/core/triage/persist';

/**
 * Correcao da triagem pelo usuario. Ver docs/07-agente-de-triagem.md
 *
 * Cada correcao vira registro em `TriageFeedback` — e a informacao mais
 * valiosa do sistema. Sem capturar isso, o agente nunca melhora e o usuario
 * desiste dele em tres semanas.
 */

const CATEGORIAS: TriageCategory[] = [
  'COBRANCA',
  'NEEDS_REPLY',
  'INFORMATIVE',
  'PROMOTIONAL',
  'SPAM',
  'DISPOSABLE',
];

const PRIORIDADES: TriagePriority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

export interface CorrigirResultado {
  ok: boolean;
  erro?: string;
}

export async function corrigirTriagem(
  unifiedItemId: string,
  _anterior: CorrigirResultado | null,
  form: FormData,
): Promise<CorrigirResultado> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  const categoria = String(form.get('category') ?? '');
  const prioridade = String(form.get('priority') ?? '');
  if (!CATEGORIAS.includes(categoria as TriageCategory)) {
    return { ok: false, erro: 'Categoria inválida' };
  }
  if (!PRIORIDADES.includes(prioridade as TriagePriority)) {
    return { ok: false, erro: 'Prioridade inválida' };
  }

  try {
    await applyUserCorrection({
      unifiedItemId,
      userId: usuario.id,
      category: categoria as TriageCategory,
      priority: prioridade as TriagePriority,
      // Checkbox ausente no FormData significa desmarcado.
      needsReply: form.get('needsReply') === 'on',
    });
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  revalidatePath('/triagem');
  revalidatePath('/');
  return { ok: true };
}
