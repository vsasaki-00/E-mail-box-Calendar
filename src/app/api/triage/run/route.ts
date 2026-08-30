import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { triageConnection } from '@/core/triage/persist';

/**
 * Roda a triagem das conexoes do usuario.
 *
 * Ver docs/07-agente-de-triagem.md. Somente leitura e sem acao: classifica e
 * grava. Nenhum e-mail e arquivado, movido ou apagado por esta rota.
 */
export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          'ANTHROPIC_API_KEY não configurada no .env. A triagem precisa dela para classificar ' +
          'o que as regras determinísticas não resolvem sozinhas.',
      },
      { status: 500 },
    );
  }

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) {
    return NextResponse.json({ error: 'Nenhum usuário; conecte uma conta antes' }, { status: 400 });
  }

  const conexoes = await prisma.connection.findMany({
    where: { userId: usuario.id, status: { notIn: ['DISABLED'] } },
    orderBy: { createdAt: 'asc' },
  });

  // Sequencial de proposito: cada conexao tem seu proprio contexto de caixa
  // e seu proprio prompt de sistema em cache. Paralelizar aqui trocaria
  // cache quente por concorrencia que a API vai limitar de qualquer jeito.
  const resumos = [];
  for (const conexao of conexoes) {
    resumos.push(await triageConnection(conexao, usuario.id));
  }

  return NextResponse.json({ results: resumos });
}
