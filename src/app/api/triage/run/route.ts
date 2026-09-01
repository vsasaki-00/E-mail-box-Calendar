import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { triageConnection } from '@/core/triage/persist';
import { envNumero } from '@/lib/env';

/**
 * Roda a triagem das conexoes do usuario.
 *
 * Ver docs/07-agente-de-triagem.md. Somente leitura e sem acao: classifica e
 * grava. Nenhum e-mail e arquivado, movido ou apagado por esta rota.
 */
// Classificar chama o modelo para cada caixa: o padrao do runtime (~15s)
// nao cobre. 60s e o teto do plano Hobby da Vercel.
export const maxDuration = 60;

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

  // UMA caixa por requisicao, em lote pequeno.
  //
  // Classificar as cinco caixas de uma vez estourava o limite da funcao
  // (FUNCTION_INVOCATION_TIMEOUT em producao): sao chamadas ao modelo em
  // sequencia, cada uma de segundos. O cliente repete enquanto sobrar
  // trabalho, e o progresso aparece na tela a cada volta.
  //
  // Sequencial dentro da caixa continua de proposito: cada conexao tem seu
  // proprio contexto e seu prompt de sistema em cache; paralelizar trocaria
  // cache quente por concorrencia que a API limita de qualquer jeito.
  const LOTE = envNumero(process.env.TRIAGE_BATCH_PER_RUN, 25);

  // Escolhe a primeira caixa que ainda tem mensagem sem classificacao.
  let alvo = null;
  let restantes = 0;
  for (const conexao of conexoes) {
    const pendentes = await prisma.message.count({
      where: {
        connectionId: conexao.id,
        unifiedItem: { userId: usuario.id, triage: null },
        mailbox: { includeInUnified: true },
      },
    });
    if (pendentes === 0) continue;
    if (!alvo) alvo = conexao;
    restantes += pendentes;
  }

  if (!alvo) {
    return NextResponse.json({ results: [], pendentes: 0, concluido: true });
  }

  const resumo = await triageConnection(alvo, usuario.id, undefined, LOTE);

  return NextResponse.json({
    results: [resumo],
    pendentes: Math.max(0, restantes - resumo.processed),
    concluido: restantes - resumo.processed <= 0,
  });
}
