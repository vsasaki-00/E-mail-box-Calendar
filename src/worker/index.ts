import { runSyncCycle } from '@/core/sync/engine';
import { runAutomationCycle } from '@/core/pipeline/run';
import { prisma } from '@/lib/db';

/**
 * Processo do worker de sincronizacao. Ver ADR-6 em docs/01-arquitetura.md
 *
 * Roda separado da UI, no mesmo codigo: um sync lento nunca trava a interface.
 * Na fase 1 o agendamento e um loop simples; quando houver volume, troca-se por
 * uma fila (BullMQ + Redis) sem tocar no nucleo.
 */

const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_SECONDS ?? 300) * 1_000;

/**
 * A automacao (triagem + cobrancas) roda com intervalo PROPRIO, mais longo
 * que o sync. Sync so custa quota do provedor; triagem custa dinheiro por
 * chamada, e nao ha valor em reclassificar de cinco em cinco minutos.
 */
const AUTOMATION_INTERVAL_MS =
  Number(process.env.AUTOMATION_INTERVAL_SECONDS ?? 900) * 1_000;

let parando = false;
let proximaAutomacao = 0;

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

/**
 * Triagem e extracao de cobrancas, depois do sync.
 *
 * NAO gera rascunho: gerar resposta automaticamente para tudo e o degrau
 * anterior a enviar automaticamente. Rascunho continua sob demanda.
 */
async function automacao(): Promise<void> {
  const inicio = Date.now();
  try {
    const resultados = await runAutomationCycle();

    for (const resultado of resultados) {
      const triados = resultado.triage.reduce((s, p) => s + p.processed, 0);
      const cobrancas = resultado.bills.reduce((s, p) => s + p.processed, 0);
      const erros = [...resultado.triage, ...resultado.bills].filter((p) => p.error);

      if (triados > 0 || cobrancas > 0) {
        // Contagens e ids, nunca conteudo. Ver docs/04-seguranca.md
        console.log(
          `[worker] automacao: ${triados} triados, ${cobrancas} cobrancas, ` +
            `gasto hoje ${resultado.usedToday.triage}/${resultado.usedToday.bills}, ` +
            `${Date.now() - inicio}ms`,
        );
      }

      // Orcamento esgotado precisa APARECER: um sistema que para de
      // trabalhar em silencio parece um sistema quebrado.
      const semOrcamento = resultado.triage.filter((p) => p.skipped === 'ORCAMENTO_ESGOTADO');
      if (semOrcamento.length > 0) {
        console.warn(
          `[worker] orcamento diario de triagem esgotado (${semOrcamento.length} caixa(s) ` +
            'aguardando). Ajuste AUTO_TRIAGE_DAILY_LIMIT se for o caso.',
        );
      }

      for (const passo of erros) {
        console.warn(`[worker] automacao ${passo.connectionId}: ${passo.error}`);
      }
    }
  } catch (error) {
    console.error('[worker] automacao falhou:', error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  console.log(
    `[worker] iniciado — sync a cada ${INTERVAL_MS / 1000}s, ` +
      `automacao a cada ${AUTOMATION_INTERVAL_MS / 1000}s`,
  );

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

    // A automacao roda no proprio ritmo, sempre DEPOIS do sync do ciclo:
    // triar antes de sincronizar processaria a caixa de ontem.
    if (Date.now() >= proximaAutomacao) {
      await automacao();
      proximaAutomacao = Date.now() + AUTOMATION_INTERVAL_MS;
    }

    // Espera fixa entre ciclos; o proprio SyncState guarda o nextRunAt de cada
    // recurso, entao o loop so precisa acordar com frequencia razoavel.
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

void main();
