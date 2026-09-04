import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_SESSAO, verificarSessao } from '@/lib/session';

/**
 * Porta de entrada do Meridiano. Ver docs/09-deploy.md
 *
 * Bloqueia TUDO por padrão e libera uma lista curta. É a ordem certa: se a
 * regra fosse "bloqueie estas rotas", cada tela nova nasceria pública e o
 * erro só apareceria quando alguém achasse a URL.
 *
 * Isto existe porque o app lê o e-mail de seis negócios. No `localhost`
 * só a máquina do dono alcança; publicado, a URL é o único segredo — e
 * URL não é segredo.
 */

/** O que pode ser acessado sem sessão. */
const PUBLICO = [
  '/entrar',
  // O callback do OAuth chega do provedor, sem o cookie da sessão. Ele é
  // protegido pelo `state` (CSRF + TTL + uso único), não pela sessão.
  '/api/auth/google/callback',
  '/api/auth/microsoft/callback',
  // Cron da Vercel: autentica pelo header, não por cookie.
  '/api/cron',
  // Webhook do WhatsApp: chega da Meta, sem cookie. Protegido pela
  // assinatura HMAC do corpo (App Secret) e por allowlist de número —
  // mesma lógica dos callbacks acima, que também não têm sessão.
  '/api/whatsapp/webhook',
  // Twilio: mesma lógica, assinatura HMAC-SHA1 com o Auth Token.
  '/api/whatsapp/twilio',
  // Sonda de saúde: quem pergunta é a Torre de Controle, de fora e sem cookie.
  // Ela não devolve dado nenhum do app — só se o banco respondeu.
  '/api/saude',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLICO.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))) {
    return NextResponse.next();
  }

  const segredo = process.env.SESSION_SECRET;
  const hash = process.env.APP_PASSWORD_HASH;
  const producao = process.env.NODE_ENV === 'production';

  // Em desenvolvimento (`next dev`), sem senha definida, o app abre direto.
  // É como ele sempre funcionou no localhost, e a alternativa seria trancar
  // você para fora da própria máquina logo depois do `pnpm setup` — com
  // `SESSION_SECRET` já escrito e nenhuma senha ainda cadastrada.
  //
  // Isto NÃO vale em produção: lá a ausência de configuração vira 503 logo
  // abaixo. `next dev` nunca é o que roda na Vercel.
  if (!producao && !hash) {
    return NextResponse.next();
  }

  // Sem segredo configurado não há como validar sessão nenhuma. Recusar é
  // a única resposta segura: liberar "porque não está configurado" seria
  // transformar um erro de configuração em porta aberta.
  if (!segredo || !hash) {
    return new NextResponse(
      'SESSION_SECRET e APP_PASSWORD_HASH são obrigatórios. Rode `pnpm gerar:senha` — ver docs/09-deploy.md',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const token = request.cookies.get(COOKIE_SESSAO)?.value;
  if (await verificarSessao(segredo, token)) {
    return NextResponse.next();
  }

  // API responde 401 seco; navegação vai para a tela de entrada.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const destino = request.nextUrl.clone();
  destino.pathname = '/entrar';
  destino.search = pathname === '/' ? '' : `?de=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(destino);
}

export const config = {
  // Tudo, menos os estáticos do Next e os arquivos que o navegador pede
  // ANTES de haver sessão.
  //
  // `icon.svg` e `apple-icon.png`: pedidos pela TELA DE LOGIN, onde por
  // definição ainda não há sessão. Dentro do portão, o navegador recebia um
  // redirecionamento em vez da imagem e a aba ficava sem ícone justamente
  // na primeira tela que você vê.
  //
  // O PWA acrescenta quatro: `manifest.webmanifest` e os ícones (lidos pelo
  // navegador, às vezes sem enviar o cookie), `sw.js` (um service worker
  // que responde redirecionamento nunca instala, e sem ele o navegador não
  // oferece "instalar") e `offline.html` (que precisa abrir justamente
  // quando não há rede para validar sessão nenhuma).
  //
  // Nenhum deles carrega conteúdo privado: são ícone, código e uma página
  // que diz "sem conexão". Ver docs/12-pwa.md
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw.js|offline.html|icone-192.png|icone-512.png).*)',
  ],
};
