'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { keyringFromEnv } from '@/lib/crypto';
import { readCredentials, runSync } from '@/core/sync/engine';
import { revokeGoogleToken } from '@/lib/connectors/google-auth';

/** Server Actions da pagina de conexoes: mesma logica das rotas de API, sem fetch. */

export async function desconectar(connectionId: string): Promise<void> {
  const conexao = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!conexao) return;

  if (conexao.provider === 'GOOGLE' && conexao.secretCiphertext) {
    try {
      const credenciais = readCredentials(conexao, keyringFromEnv());
      if (credenciais.refreshToken) await revokeGoogleToken(credenciais.refreshToken);
    } catch {
      // Sem credencial legivel, nao ha o que revogar no provedor.
    }
  }

  await prisma.connection.delete({ where: { id: connectionId } });
  revalidatePath('/conexoes');
  revalidatePath('/');
}

export async function sincronizarAgora(connectionId: string): Promise<void> {
  const estados = await prisma.syncState.findMany({
    where: { connectionId, resource: { in: ['MAIL', 'CALENDAR'] } },
    include: { connection: true },
  });

  for (const estado of estados) {
    await runSync(estado, new Date());
  }

  revalidatePath('/conexoes');
  revalidatePath('/');
}
