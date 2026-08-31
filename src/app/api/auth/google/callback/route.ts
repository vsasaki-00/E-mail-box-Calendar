import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { evaluateWriteGrant } from '@/core/actions/scopes';
import { keyringFromEnv } from '@/lib/crypto';
import { googleCapabilities } from '@/lib/connectors/google';
import {
  exchangeGoogleCode,
  fetchGoogleAccountEmail,
  googleOAuthConfigFromEnv,
} from '@/lib/connectors/google-auth';
import { consumirOAuthState } from '@/core/auth/oauth-state';
import { saveCredentials } from '@/core/sync/engine';

/**
 * Callback do OAuth do Google. Troca o `code` por credenciais, cria (ou
 * reativa) a Connection e agenda o primeiro sync. Ver docs/03-conectores.md
 *
 * Erros aqui viram uma pagina simples em vez de JSON: quem chega aqui e o
 * navegador do usuario, redirecionado pelo Google.
 */

function paginaDeErro(titulo: string, detalhe: string): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Falha ao conectar</title></head>
<body style="font-family:system-ui;max-width:560px;margin:64px auto;padding:0 20px">
<h1 style="font-size:18px">${titulo}</h1>
<p style="color:#666">${detalhe}</p>
<p><a href="/">Voltar</a></p>
</body></html>`;
  return new NextResponse(html, { status: 400, headers: { 'Content-Type': 'text/html' } });
}

const PROVIDER = 'GOOGLE' as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const erroOAuth = url.searchParams.get('error');

  if (erroOAuth) {
    return paginaDeErro(
      'Autorizacao recusada',
      erroOAuth === 'access_denied'
        ? 'Voce cancelou a autorizacao no Google.'
        : `O Google devolveu o erro: ${erroOAuth}`,
    );
  }

  if (!code || !state) {
    return paginaDeErro('Callback invalido', 'Faltam os parametros code ou state.');
  }

  // Consumir apaga o registro na mesma operacao: reenvio do callback (o
  // usuario dando F5) falha aqui em vez de reprocessar um code ja trocado.
  const estado = await consumirOAuthState(state);
  if (!estado || estado.provider !== 'GOOGLE') {
    return paginaDeErro(
      'Link expirado',
      'Este link de autorizacao expirou ou ja foi usado. Tente conectar novamente.',
    );
  }

  let credenciais;
  try {
    const config = googleOAuthConfigFromEnv();
    credenciais = await exchangeGoogleCode({ code, codeVerifier: estado.codeVerifier, config });
  } catch (error) {
    return paginaDeErro(
      'Falha ao trocar o codigo de autorizacao',
      error instanceof Error ? error.message : String(error),
    );
  }

  const accountEmail = await fetchGoogleAccountEmail(credenciais.accessToken as string);

  const usuario =
    (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })) ??
    (await prisma.user.create({ data: { email: accountEmail } }));

  const conexao = await prisma.connection.upsert({
    where: { userId_provider_accountEmail: { userId: usuario.id, provider: 'GOOGLE', accountEmail } },
    create: {
      userId: usuario.id,
      provider: 'GOOGLE',
      accountEmail,
      displayName: accountEmail,
      capabilities: googleCapabilities as never,
      status: 'ACTIVE',
    },
    // Reconectar uma conta existente limpa o erro anterior e reativa o sync.
    update: { status: 'ACTIVE', lastErrorMessage: null, lastErrorAt: null },
  });

  await saveCredentials(conexao.id, credenciais, keyringFromEnv());

  // Escrita (fase 4): decide pelo que o provedor CONCEDEU, nao pelo que
  // pedimos. O usuario pode desmarcar permissoes na tela de consentimento e
  // o fluxo ainda assim volta com sucesso. Ver docs/08-escrita-e-acoes.md
  const concessao = evaluateWriteGrant(PROVIDER, credenciais.grantedScopes);
  await prisma.connection.update({
    where: { id: conexao.id },
    data: {
      grantedScopes: concessao.granted,
      // Um fluxo de leitura nunca DESLIGA a escrita ja concedida: voce
      // reconectar uma caixa para arrumar o sync nao pode revogar em
      // silencio uma permissao que voce deu de proposito.
      ...(estado.requestWrite ? { writeEnabled: concessao.enabled } : {}),
    },
  });

  // Um SyncState por recurso que o conector declara suportar. Sem cursor:
  // a proxima execucao faz full sync.
  for (const resource of ['MAIL', 'CALENDAR'] as const) {
    await prisma.syncState.upsert({
      where: { connectionId_resource: { connectionId: conexao.id, resource } },
      create: { connectionId: conexao.id, resource, nextRunAt: new Date() },
      update: { nextRunAt: new Date(), status: 'IDLE', failureCount: 0 },
    });
  }

  return NextResponse.redirect(new URL(estado.redirectAfter ?? '/', url.origin));
}
