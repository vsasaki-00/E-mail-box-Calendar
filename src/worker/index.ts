import { runSyncCycle } from '@/core/sync/engine';
import { prisma } from '@/lib/db';

/**
 * Processo do worker de sincronizacao. Ver ADR-6 em docs/01-arquitetura.md
 *
 * Roda separado da UI, no mesmo codigo: um sync lento nunca trava a interface.
 * Na fase 1 o agendamento e um loop simples; quando houver volume, troca-se por
 * uma fila (BullMQ + Redis) sem tocar no nucleo.
 */

const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_SECONDS ?? 300) * 1_000;

let parando = false;

async function ciclo(): Promise<void> {
  const inicio = Date.now();
  try {
    const resultados = await runSyncCycle();
    if (resultados.length > 0) {
      const falhas = resultados.filter((r) => r.outcome === 'FAILED').length;
      // Log com contagens e ids, nunca conteudo. Ver docs/04-seguranca.md
      console.log(
        `[worker] ciclo: ${resultados.length} recursos, ${falhas} falhas, ${Date.now() - inicio}ms`,
      );
      for (const resultado of resultados.filter((r) => r.errorMessage)) {
        console.warn(
          `[worker] ${resultado.connectionId}/${resultado.resource}: ${resultado.errorMessage}`,
        );
      }
    }
  } catch (error) {
    // Um ciclo que explode nao pode matar o worker: o proximo tenta de novo.
    console.error('[worker] ciclo falhou:', error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  console.log(`[worker] iniciado, intervalo de ${INTERVAL_MS / 1000}s`);

  const encerrar = async (sinal: string) => {
    if (parando) return;
    parando = true;
    console.log(`[worker] ${sinal} recebido, encerrando`);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void encerrar('SIGINT'));
  process.on('SIGTERM', () => void encerrar('SIGTERM'));

  while (!parando) {
    await ciclo();
    // Espera fixa entre ciclos; o proprio SyncState guarda o nextRunAt de cada
    // recurso, entao o loop so precisa acordar com frequencia razoavel.
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

void main();
