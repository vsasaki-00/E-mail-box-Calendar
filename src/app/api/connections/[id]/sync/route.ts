import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { agendarSyncImediato, runSync } from '@/core/sync/engine';

// Sem isto a rota fica no timeout padrao do runtime (~10-15s), que nao
// comporta o primeiro sync de uma caixa com 90 dias de historico. 60s e o
// teto seguro do plano Hobby da Vercel; o corte continua nao sendo fatal —
// o pageToken persiste e o proximo clique (ou o cron) retoma do ponto.
export const maxDuration = 60;

/**
 * Forca um sync agora, sem esperar o worker.
 *
 * Roda inline (nao so agenda) para dar feedback imediato no primeiro clique
 * apos conectar uma conta — esperar ate 5 minutos pelo worker na primeira
 * experiencia seria ruim. Tem timeout implicito do runtime da rota: paginas
 * grandes continuam via `pageToken` nas execucoes seguintes do worker.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  await agendarSyncImediato(id);

  const estados = await prisma.syncState.findMany({
    where: { connectionId: id, resource: { in: ['MAIL', 'CALENDAR'] } },
    include: { connection: true },
  });

  const resultados = [];
  for (const estado of estados) {
    resultados.push(await runSync(estado, new Date()));
  }

  return NextResponse.json({ results: resultados });
}
