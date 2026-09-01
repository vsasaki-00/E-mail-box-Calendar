import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { evaluateWriteGrant } from '@/core/actions/scopes';
import { keyringFromEnv } from '@/lib/crypto';
import { microsoftCapabilities } from '@/lib/connectors/microsoft';
import {
  exchangeMicrosoftCode,
  fetchMicrosoftAccountEmail,
  microsoftOAuthConfigFromEnv,
} from '@/lib/connectors/microsoft-auth';
import { consumirOAuthState } from '@/core/auth/oauth-state';
import { saveCredentials } from '@/core/sync/engine';

/**
 * Callback do OAuth do Microsoft. Espelha /api/auth/google/callback — mesmo
 * tratamento de erro, mesma criacao de Connection + SyncState.
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

const PROVIDER = 'MICROSOFT' as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const erroOAuth = url.searchParams.get('error');
  const erroDescricao = url.searchParams.get('error_description');

  if (erroOAuth) {
    return paginaDeErro(
      'Autorizacao recusada',
      erroOAuth === 'access_denied'
        ? 'Voce cancelou a autorizacao na Microsoft.'
        : `A Microsoft devolveu o erro: ${erroOAuth}${erroDescricao ? ` — ${erroDescricao}` : ''}`,
    );
  }

  if (!code || !state) {
    return paginaDeErro('Callback invalido', 'Faltam os parametros code ou state.');
  }

  // Consumir apaga o registro na mesma operacao: reenvio do callback (o
  // usuario dando F5) falha aqui em vez de reprocessar um code ja trocado.
  const estado = await consumirOAuthState(state);
  if (!estado || estado.provider !== 'MICROSOFT') {
    return paginaDeErro(
      'Link expirado',
      'Este link de autorizacao expirou ou ja foi usado. Tente conectar novamente.',
    );
  }

  let credenciais;
  try {
    const config = microsoftOAuthConfigFromEnv();
    credenciais = await exchangeMicrosoftCode({ code, codeVerifier: estado.codeVerifier, config });
  } catch (error) {
    return paginaDeErro(
      'Falha ao trocar o codigo de autorizacao',
      error instanceof Error ? error.message : String(error),
    );
  }

  const accountEmail = await fetchMicrosoftAccountEmail(credenciais.accessToken as string);

  const usuario =
    (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })) ??
    (await prisma.user.create({ data: { email: accountEmail } }));

  const conexao = await prisma.connection.upsert({
    where: {
      userId_provider_accountEmail: { userId: usuario.id, provider: 'MICROSOFT', accountEmail },
    },
    create: {
      userId: usuario.id,
      provider: 'MICROSOFT',
      accountEmail,
      displayName: accountEmail,
      color: '#0078d4',
      capabilities: microsoftCapabilities as never,
      status: 'ACTIVE',
    },
    // Reconectar uma conta existente limpa o erro anterior e reativa o sync.
    update: { status: 'ACTIVE', lastErrorMessage: null, lastErrorAt: null },
  });

  // A partir daqui a Connection JA EXISTE na tela do usuario. Se algo
  // falhar sem tratamento, ela fica parecendo saudavel e nunca sincroniza —
  // foi exatamente o que aconteceu em producao quando a MASTER_ENCRYPTION_KEY
  // estava ausente. Falha aqui precisa MARCAR a conexao, nao virar 500 mudo.
  try {
    await saveCredentials(conexao.id, credenciais, keyringFromEnv());
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    await prisma.connection.update({
      where: { id: conexao.id },
      data: {
        status: 'REAUTH_REQUIRED',
        lastErrorAt: new Date(),
        lastErrorMessage: `Falha ao guardar credenciais: ${mensagem}`,
      },
    });
    return paginaDeErro('Falha ao guardar as credenciais', mensagem);
  }

  // Escrita (fase 4): decide pelo que o provedor CONCEDEU, nao pelo que
  // pedimos. O usuario pode desmarcar permissoes na tela de consentimento e
  // o fluxo ainda assim volta com sucesso. Ver docs/08-escrita-e-acoes.md
  const concessao = evaluateWriteGrant(PROVIDER, credenciais.grantedScopes);
  await prisma.connection.update({
    where: { id: conexao.id },
    data: {
      grantedScopes: concessao.granted,
      // `writeEnabled` segue o que o provedor CONCEDEU, em qualquer fluxo.
      //
      // Antes so era atualizado no fluxo de escrita, para nao revogar em
      // silencio uma permissao dada de proposito. Mas reconectar em modo
      // leitura revoga de verdade no provedor: manter a flag ligada deixava
      // a tela dizendo "escrita autorizada" com um token que nao escreve, e
      // a acao so falharia na hora de executar — depois de voce confirmar.
      //
      // A condicao existe porque `evaluateWriteGrant` responde "nao" quando
      // nao ha informacao de escopo. Isso e o padrao certo para decidir, e
      // seria errado como motivo para DESLIGAR algo: sem saber, nao se
      // muda nada.
      ...(credenciais.grantedScopes ? { writeEnabled: concessao.enabled } : {}),
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
