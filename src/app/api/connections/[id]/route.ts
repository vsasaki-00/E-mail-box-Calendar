import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readCredentials } from '@/core/sync/engine';
import { keyringFromEnv } from '@/lib/crypto';
import { revokeGoogleToken } from '@/lib/connectors/google-auth';

/**
 * Desconecta uma conta: revoga o token no provedor (melhor-esforco) e apaga o
 * cache local em cascata. Ver docs/04-seguranca.md — nao deixamos token vivo
 * nem no provedor nem aqui.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const conexao = await prisma.connection.findUnique({ where: { id } });
  if (!conexao) {
    return NextResponse.json({ error: 'Conexao nao encontrada' }, { status: 404 });
  }

  if (conexao.provider === 'GOOGLE' && conexao.secretCiphertext) {
    try {
      const credenciais = readCredentials(conexao, keyringFromEnv());
      if (credenciais.refreshToken) await revokeGoogleToken(credenciais.refreshToken);
    } catch {
      // Sem credencial legivel ja nao ha o que revogar; segue para apagar o cache.
    }
  }

  // Cascata do schema cuida de mailboxes, mensagens, eventos e sync states.
  await prisma.connection.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
