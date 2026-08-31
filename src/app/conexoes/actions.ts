'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { keyringFromEnv } from '@/lib/crypto';
import { readCredentials } from '@/core/sync/engine';
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

// A antiga action `sincronizarAgora` foi substituida pelos botoes de
// `sync-controls.tsx`, que chamam a rota /api/connections/[id]/sync em loop
// com progresso visivel. Uma Server Action nao serve para isso: ela roda
// uma vez, sem feedback intermediario, e o primeiro sync real provou que
// "sem feedback" e indistinguivel de "quebrado".
