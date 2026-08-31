/**
 * Teto de gasto da automacao. Ver docs/07-agente-de-triagem.md
 *
 * O problema que isto resolve: a triagem roda sozinha a cada ciclo e
 * **custa dinheiro a cada chamada**. Sem teto, uma enxurrada de e-mail, um
 * loop mal comportado ou um provedor devolvendo a caixa inteira de novo
 * viram uma conta alta que voce so descobre no fim do mes.
 *
 * O consumo do dia e DERIVADO das linhas que a automacao gravou, nao de um
 * contador proprio: contador em tabela separada dessincroniza do que
 * realmente aconteceu — e um contador que mente sobre gasto e pior do que
 * nao ter contador.
 *
 * Funcoes puras, testaveis sem banco.
 */

export interface DailyBudget {
  /** Itens classificados pelo modelo por dia. */
  maxTriage: number;
  /** Cobrancas extraidas com ajuda do modelo por dia. */
  maxBills: number;
}

/**
 * Padroes deliberadamente generosos para uso pessoal e baratos o
 * suficiente para um acidente nao doer: ver a conta em
 * docs/07-agente-de-triagem.md.
 */
export const DEFAULT_DAILY_BUDGET: DailyBudget = {
  maxTriage: 1500,
  maxBills: 200,
};

export function budgetFromEnv(env: Record<string, string | undefined> = process.env): DailyBudget {
  const ler = (chave: string, padrao: number): number => {
    const bruto = env[chave];
    if (bruto === undefined) return padrao;
    const numero = Number(bruto);
    // Valor invalido cai no padrao em vez de virar NaN — NaN em comparacao
    // e sempre falso, e o teto silenciosamente sumiria.
    if (!Number.isFinite(numero) || numero < 0) return padrao;
    return Math.floor(numero);
  };

  return {
    maxTriage: ler('AUTO_TRIAGE_DAILY_LIMIT', DEFAULT_DAILY_BUDGET.maxTriage),
    maxBills: ler('AUTO_BILLS_DAILY_LIMIT', DEFAULT_DAILY_BUDGET.maxBills),
  };
}

/** Quanto ainda cabe hoje. Nunca negativo. */
export function remaining(usadoHoje: number, teto: number): number {
  return Math.max(0, teto - usadoHoje);
}

export type SkipReason =
  | 'SEM_CHAVE_DE_API'
  | 'ORCAMENTO_ESGOTADO'
  | 'NADA_PENDENTE'
  | 'DESLIGADO';

export interface RunDecision {
  run: boolean;
  /** Quantos itens processar nesta rodada. */
  limit: number;
  reason?: SkipReason;
}

/**
 * Decide se vale rodar, e com que limite.
 *
 * O limite da rodada e o MENOR entre o que sobrou do dia e o teto por
 * ciclo: sem isso, um dia inteiro de orcamento poderia ser gasto num unico
 * ciclo logo depois do primeiro sync de uma caixa antiga.
 */
export function decideRun(params: {
  enabled: boolean;
  hasApiKey: boolean;
  pending: number;
  usedToday: number;
  dailyLimit: number;
  perCycleLimit: number;
}): RunDecision {
  if (!params.enabled) return { run: false, limit: 0, reason: 'DESLIGADO' };
  if (!params.hasApiKey) return { run: false, limit: 0, reason: 'SEM_CHAVE_DE_API' };
  if (params.pending <= 0) return { run: false, limit: 0, reason: 'NADA_PENDENTE' };

  const sobra = remaining(params.usedToday, params.dailyLimit);
  if (sobra <= 0) return { run: false, limit: 0, reason: 'ORCAMENTO_ESGOTADO' };

  return { run: true, limit: Math.min(sobra, params.perCycleLimit, params.pending) };
}

/** Inicio do dia local. O orcamento e diario no fuso de quem paga a conta. */
export function startOfDay(now = new Date()): Date {
  const inicio = new Date(now);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}
