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
export async function GET(request: Request) {
  // `?write=1` pede os escopos de ESCRITA (fase 4). Sem o parametro, o
  // fluxo continua sendo o de leitura — escrita nunca acontece por padrao.
  const pedeEscrita = new URL(request.url).searchParams.get('write') === '1';
  const contaSugerida = new URL(request.url).searchParams.get('conta')?.trim() || undefined;
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
        // Volta avisando QUAL conta foi pedida. A fila de reconexao usa isso
    // para se limpar mesmo quando o provedor devolve um alias diferente do
    // e-mail digitado — comum em conta pessoal Microsoft, que tem varios
    // enderecos para a mesma caixa.
    redirectAfter: contaSugerida
      ? `/conexoes?reconectado=${encodeURIComponent(contaSugerida)}`
      : '/conexoes',
    requestWrite: pedeEscrita,
  });

  const url = buildGoogleAuthUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    codeChallenge: challenge,
    write: pedeEscrita,
    // `?conta=` vem da fila de reconexao: leva a tela do Google ja apontando
    // para a caixa certa, em vez de fazer voce achar a conta na lista a cada
    // reconexao. E so uma sugestao — o provedor continua exigindo que VOCE
    // escolha e autorize, que e o ponto do OAuth.
    loginHint: contaSugerida ?? (usuario.email !== 'owner@local' ? usuario.email : undefined),
  });

  return NextResponse.redirect(url);
}
