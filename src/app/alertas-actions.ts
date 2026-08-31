'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { acknowledgeAlert, unacknowledgeAlert } from '@/core/alerts/persist';

/** Reconhecimento de alerta na Torre. Ver docs/05-torre-de-controle.md */

export async function reconhecerAlerta(alertId: string): Promise<void> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return;
  await acknowledgeAlert(alertId, usuario.id);
  revalidatePath('/');
}

export async function reabrirAlerta(alertId: string): Promise<void> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return;
  await unacknowledgeAlert(alertId, usuario.id);
  revalidatePath('/');
}
