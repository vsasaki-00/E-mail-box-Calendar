import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildGoogleAuthUrl, createPkcePair } from '@/lib/connectors/google';
import { googleOAuthConfigFromEnv } from '@/lib/connectors/google-auth';
import { criarOAuthState, limparOAuthStatesExpirados } from '@/core/auth/oauth-state';

/**
 * Inicia o fluxo OAuth do Google. Ver docs/03-conectores.md
 *
 * GET em vez de POST porque este endpoint so redireciona — nao muda estado
 * proprio antes do callback confirmar. O `state` e o verifier do PKCE ficam
 * no banco (ver core/auth/oauth-state.ts), nao em cookie: o verifier nunca
 * pode aparecer no navegador.
 */
export async function GET() {
  let config;
  try {
    config = googleOAuthConfigFromEnv();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  // Single-user na fase 1: garante que existe um usuario dono das conexoes.
  const usuario =
    (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })) ??
    (await prisma.user.create({ data: { email: 'owner@local' } }));

  await limparOAuthStatesExpirados();

  const { verifier, challenge } = createPkcePair();
  const state = await criarOAuthState({
    provider: 'GOOGLE',
    codeVerifier: verifier,
    redirectAfter: '/',
  });

  const url = buildGoogleAuthUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    codeChallenge: challenge,
    loginHint: usuario.email !== 'owner@local' ? usuario.email : undefined,
  });

  return NextResponse.redirect(url);
}
