import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { obterCorpo } from '@/core/mail/corpo';
import { documentoParaIframe } from '@/core/mail/html-seguro';

/**
 * Corpo de uma mensagem, para leitura na tela.
 *
 * Protegida pelo middleware como tudo em /api que nao esta na lista publica.
 * Busca no provedor na primeira vez; depois vem do cache na Message.
 *
 * O HTML so vai quando pedido (`?html=1`), e ja vai EMBALADO para iframe
 * com sandbox e CSP — a pagina nunca recebe HTML de e-mail solto.
 */

// A primeira leitura fala com o provedor; 10s do runtime nao cobrem um
// Graph lento.
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return NextResponse.json({ error: 'Sem usuário' }, { status: 400 });

  const resultado = await obterCorpo(id, usuario.id);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
  }

  const querHtml = new URL(request.url).searchParams.get('html') === '1';
  const { corpo } = resultado;

  return NextResponse.json(
    {
      textoNovo: corpo.textoNovo,
      textoCompleto: corpo.textoCompleto,
      // `srcdoc` pronto, nao HTML cru.
      htmlSandbox: querHtml && corpo.html ? documentoParaIframe(corpo.html) : undefined,
      temHtml: Boolean(corpo.html),
      de: corpo.de,
      para: corpo.para,
      recebidoEm: corpo.recebidoEm.toISOString(),
      caixa: corpo.caixa,
      link: corpo.link,
      buscadoAgora: corpo.buscadoAgora,
    },
    {
      // Corpo de e-mail nunca deve parar em cache compartilhado.
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
