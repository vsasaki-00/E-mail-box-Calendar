import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { lerAllowlist, numeroAutorizado } from '@/core/whatsapp/seguranca';
import { assinaturaTwilioConfere, converterTwilio, urlPublica } from '@/core/whatsapp/twilio';
import { registrarMensagem } from '@/core/whatsapp/entrada';

/**
 * Webhook do Twilio (BSP homologado). Ver docs/11-whatsapp.md
 *
 * Publico no middleware, como o da Cloud API e os callbacks de OAuth: quem
 * chama e o Twilio, sem cookie. A porta e a ASSINATURA (HMAC-SHA1 da URL
 * mais os parametros ordenados, com o Auth Token) somada a allowlist de
 * numero — as duas obrigatorias.
 *
 * Nao ha handshake de verificacao aqui: o Twilio nao faz o GET com
 * challenge que a Meta faz.
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * GET: alguem abriu a URL no navegador.
 *
 * Quase sempre e o dono, conferindo se o webhook esta no ar. Sem isto a
 * resposta era um 405 cru — "Esta pagina nao esta funcionando" — que le
 * como app quebrado quando significa o oposto: a rota existe e esta viva.
 *
 * Esta rota e publica, entao a pagina nao diz NADA sobre configuracao —
 * nem se o token existe, nem quantos numeros a allowlist tem. Isso fica em
 * /financeiro/entrada, atras da senha.
 */
export function GET() {
  const texto = [
    'Webhook do Twilio (WhatsApp) do Meridiano.',
    '',
    'Ver esta pagina significa que a rota esta publicada e no ar.',
    '',
    'Ela recebe POST — o que o Twilio envia quando chega uma mensagem. O',
    'navegador faz GET, por isso nao ha nada para mostrar aqui.',
    '',
    'Para configurar no Twilio: "When a message comes in" -> esta URL, metodo POST.',
    'O estado do canal (provedor, numeros aceitos) esta em /financeiro/entrada.',
    '',
  ].join('\n');
  return new NextResponse(texto, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return NextResponse.json({ error: 'TWILIO_AUTH_TOKEN não configurado' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Corpo ilegivel: 200 para o Twilio nao reentregar para sempre algo
    // que nunca vai melhorar.
    return NextResponse.json({ ok: true, ignoradas: 'corpo ilegível' });
  }

  const params: Record<string, string> = {};
  for (const [chave, valor] of form.entries()) {
    if (typeof valor === 'string') params[chave] = valor;
  }

  // A URL tem de ser a que o Twilio chamou, nao a interna da funcao.
  const url = urlPublica(request, '/api/whatsapp/twilio');
  if (!assinaturaTwilioConfere(url, params, request.headers.get('x-twilio-signature'), authToken)) {
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 403 });
  }

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return NextResponse.json({ ok: true, ignoradas: 'sem usuário' });

  const mensagem = converterTwilio(params);
  if (!mensagem) return NextResponse.json({ ok: true, ignoradas: 'sem mensagem no corpo' });

  // Numero de fora: descarta em silencio. Nao registra, nao responde, nao
  // conta a quem mandou o que aconteceu.
  if (!numeroAutorizado(mensagem.fromNumber, lerAllowlist(process.env.WHATSAPP_ALLOWED_NUMBERS))) {
    return NextResponse.json({ ok: true, registradas: 0, recusadas: 1 });
  }

  const r = await registrarMensagem(usuario.id, mensagem);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 500 });

  // So contagens. Nunca o texto da mensagem.
  return NextResponse.json({ ok: true, registradas: r.duplicada ? 0 : 1, duplicadas: r.duplicada ? 1 : 0 });
}
