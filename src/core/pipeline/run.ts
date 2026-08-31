import { prisma } from '@/lib/db';
import { triageConnection } from '@/core/triage/persist';
import { extractBillsForConnection } from '@/core/finance/persist';
import { budgetFromEnv, decideRun, startOfDay, type SkipReason } from './budget';

/**
 * Automacao pos-sync. Ver docs/07-agente-de-triagem.md
 *
 * Depois que o sync traz mensagens novas, dois passos rodam sozinhos:
 * triagem e extracao de cobrancas. Sem isso o sistema e uma ferramenta que
 * voce opera; com isso e um sistema que trabalha.
 *
 * O QUE NAO RODA SOZINHO — e a decisao mais importante deste arquivo:
 * **rascunho**. Gerar resposta automaticamente para tudo e o degrau
 * anterior a enviar automaticamente, e a fase 5D existe justamente para
 * manter voce no meio do caminho. Rascunho continua sendo um por vez,
 * quando voce pede.
 *
 * Tudo aqui e idempotente e converge: a triagem so pega itens sem triagem,
 * a extracao so pega cobrancas sem extracao. Rodar duas vezes seguidas nao
 * refaz trabalho nem gasta duas vezes.
 */

/** Quantos itens no maximo por ciclo, para nao queimar o dia de uma vez. */
export const TRIAGE_PER_CYCLE = 200;
export const BILLS_PER_CYCLE = 60;

export interface AutomationStep {
  connectionId: string;
  accountEmail: string;
  processed: number;
  skipped?: SkipReason;
  error?: string;
}

export interface AutomationResult {
  userId: string;
  triage: AutomationStep[];
  bills: AutomationStep[];
  /** Consumo do dia depois desta rodada, para o log. */
  usedToday: { triage: number; bills: number };
}

/**
 * Consumo do dia, derivado das linhas que a automacao gravou.
 *
 * Contar `source: MODEL` e nao o total: regra deterministica nao gasta
 * chamada, e inclui-la no teto faria o orcamento acabar sem ter havido
 * gasto nenhum.
 */
export async function usageToday(
  userId: string,
  now = new Date(),
): Promise<{ triage: number; bills: number }> {
  const desde = startOfDay(now);

  const [triage, bills] = await Promise.all([
    prisma.itemTriage.count({ where: { userId, source: 'MODEL', updatedAt: { gte: desde } } }),
    prisma.billExtraction.count({
      where: { userId, source: 'MODEL', extractedAt: { gte: desde } },
    }),
  ]);

  return { triage, bills };
}

export interface AutomationOptions {
  enabled?: boolean;
  hasApiKey?: boolean;
  now?: Date;
  env?: Record<string, string | undefined>;
}

/**
 * Roda a automacao de um usuario.
 *
 * Nunca lanca: uma caixa com problema nao pode impedir as outras, mesma
 * degradacao por conexao do motor de sync.
 */
export async function runAutomationForUser(
  userId: string,
  options: AutomationOptions = {},
): Promise<AutomationResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? env.AUTO_PIPELINE !== 'false';
  const hasApiKey = options.hasApiKey ?? Boolean(env.ANTHROPIC_API_KEY);
  const orcamento = budgetFromEnv(env);

  const conexoes = await prisma.connection.findMany({
    where: { userId, status: { in: ['ACTIVE', 'DEGRADED'] } },
    orderBy: { createdAt: 'asc' },
  });

  const usado = await usageToday(userId, now);
  const triage: AutomationStep[] = [];
  const bills: AutomationStep[] = [];

  for (const conexao of conexoes) {
    const base = { connectionId: conexao.id, accountEmail: conexao.accountEmail };

    // --- Triagem ---
    const pendentes = await prisma.unifiedItem.count({
      where: {
        userId,
        kind: 'MESSAGE',
        triage: null,
        messages: { some: { connectionId: conexao.id, mailbox: { includeInUnified: true } } },
      },
    });

    const decisao = decideRun({
      enabled,
      hasApiKey,
      pending: pendentes,
      usedToday: usado.triage,
      dailyLimit: orcamento.maxTriage,
      perCycleLimit: TRIAGE_PER_CYCLE,
    });

    if (!decisao.run) {
      triage.push({ ...base, processed: 0, skipped: decisao.reason });
    } else {
      const resumo = await triageConnection(conexao, userId);
      // So o que o MODELO decidiu conta para o teto: regra deterministica
      // nao gasta chamada nenhuma.
      usado.triage += resumo.decidedByModel;
      triage.push({
        ...base,
        processed: resumo.processed,
        ...(resumo.error ? { error: resumo.error } : {}),
      });
    }

    // --- Cobrancas ---
    const cobrancasPendentes = await prisma.unifiedItem.count({
      where: {
        userId,
        bill: null,
        triage: { category: 'COBRANCA' },
        messages: { some: { connectionId: conexao.id } },
      },
    });

    const decisaoBills = decideRun({
      enabled,
      // A extracao financeira roda MESMO sem chave: boleto e PIX sao lidos
      // localmente. Por isso `hasApiKey: true` aqui — o que o modelo faria
      // simplesmente nao acontece, e a cobranca ainda aparece no painel.
      hasApiKey: true,
      pending: cobrancasPendentes,
      usedToday: usado.bills,
      dailyLimit: hasApiKey ? orcamento.maxBills : Number.MAX_SAFE_INTEGER,
      perCycleLimit: BILLS_PER_CYCLE,
    });

    if (!decisaoBills.run) {
      bills.push({ ...base, processed: 0, skipped: decisaoBills.reason });
    } else {
      const resumo = await extractBillsForConnection(conexao, userId, undefined, now);
      // So o que precisou do modelo conta. `Math.max` porque uma correcao
      // sua pulada faz `extracted` ficar abaixo de `withInstrument`, e um
      // contador de gasto que anda para tras e um contador quebrado.
      usado.bills += Math.max(0, resumo.extracted - resumo.withInstrument);
      bills.push({
        ...base,
        processed: resumo.extracted,
        ...(resumo.error ? { error: resumo.error } : {}),
      });
    }
  }

  return { userId, triage, bills, usedToday: usado };
}

/** Roda a automacao de todos os usuarios. Uma falha nao derruba as outras. */
export async function runAutomationCycle(
  options: AutomationOptions = {},
): Promise<AutomationResult[]> {
  // Desligada por completo: nem consulta o banco. A checagem existia so
  // por usuario, depois do findMany — o que fazia um pipeline desligado
  // ainda bater no banco a cada ciclo.
  if ((options.enabled ?? process.env.AUTO_PIPELINE !== 'false') === false) {
    return [];
  }

  const usuarios = await prisma.user.findMany({ select: { id: true } });
  const resultados: AutomationResult[] = [];

  for (const usuario of usuarios) {
    try {
      resultados.push(await runAutomationForUser(usuario.id, options));
    } catch (erro) {
      console.error(
        `[pipeline] usuario ${usuario.id} falhou:`,
        erro instanceof Error ? erro.message : erro,
      );
    }
  }

  return resultados;
}
