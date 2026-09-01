import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildMicrosoftAuthUrl, createPkcePair } from '@/lib/connectors/microsoft';
import { microsoftOAuthConfigFromEnv } from '@/lib/connectors/microsoft-auth';
import { criarOAuthState, limparOAuthStatesExpirados } from '@/core/auth/oauth-state';

/**
 * Inicia o fluxo OAuth do Microsoft. Ver docs/03-conectores.md
 *
 * Espelha /api/auth/google/start: mesmo mecanismo de state+PKCE persistido no
 * banco (core/auth/oauth-state.ts), so troca o provedor.
 */
export async function GET(request: Request) {
  // `?write=1` pede os escopos de ESCRITA (fase 4). Sem o parametro, o
  // fluxo continua sendo o de leitura — escrita nunca acontece por padrao.
  const pedeEscrita = new URL(request.url).searchParams.get('write') === '1';
  const contaSugerida = new URL(request.url).searchParams.get('conta')?.trim() || undefined;
  const emPopup = new URL(request.url).searchParams.get('popup') === '1';

  const retorno = new URLSearchParams();
  if (contaSugerida) retorno.set('reconectado', contaSugerida);
  if (emPopup) retorno.set('popup', '1');
  const destinoQuery = retorno.size > 0 ? `?${retorno}` : '';
  let config;
  try {
    config = microsoftOAuthConfigFromEnv();
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
    provider: 'MICROSOFT',
    codeVerifier: verifier,
    // Volta avisando QUAL conta foi pedida (a fila de reconexao usa isso para
    // se limpar mesmo quando o provedor devolve um alias diferente do e-mail
    // digitado — comum em conta pessoal Microsoft) e se o fluxo comecou
    // numa janelinha, que precisa se fechar ao terminar.
    redirectAfter: `/conexoes${destinoQuery}`,
    requestWrite: pedeEscrita,
  });

  const url = buildMicrosoftAuthUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    codeChallenge: challenge,
    write: pedeEscrita,
    tenant: config.tenant,
    loginHint: contaSugerida,
  });

  return NextResponse.redirect(url);
}
