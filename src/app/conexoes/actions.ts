'use server';

import { prisma } from '@/lib/db';
import { keyringFromEnv } from '@/lib/crypto';
import { readCredentials } from '@/core/sync/engine';
import { revokeGoogleToken } from '@/lib/connectors/google-auth';

/**
 * Sobrou uma funcao so nesta pagina.
 *
 * Sincronizar e desconectar deixaram de ser Server Actions e passaram a
 * chamar as rotas /api/connections/... a partir de `sync-controls.tsx`. O
 * motivo apareceu em producao: uma Server Action que falha ou nao faz nada
 * deixa a tela exatamente igual, e "igual" e indistinguivel de "quebrado".
 * Os botoes de agora mostram progresso e escrevem o erro na tela.
 */

/** Mantida para uso programatico (scripts, testes); a UI usa DELETE /api/connections/[id]. */
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
}
