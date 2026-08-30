import type { TriageCalibration } from './types';

/**
 * Os contextos de negocio do usuario. Ver docs/07-agente-de-triagem.md
 *
 * Lista fixa em vez de texto livre porque o nome do negocio ENTRA NO PROMPT
 * de triagem: "Consultoria Alfa" e "consultoria alfa" e "Alfa" produziriam
 * contextos diferentes para o modelo entre caixas que deveriam ser iguais.
 *
 * `OUTROS` existe para caixa que nao se encaixa; `PESSOAIS` e tratado
 * diferente porque caixa pessoal tem outra economia de erro (cheia de
 * newsletter, e perder uma nao custa um negocio).
 */
export const BUSINESS_CONTEXTS = [
  'Unitedcom',
  'Cordex.AI',
  'Brand.co',
  'EmpreendaSim',
  'Outros',
  'Pessoais',
] as const;

export type BusinessContext = (typeof BUSINESS_CONTEXTS)[number];

export function isBusinessContext(valor: string): valor is BusinessContext {
  return (BUSINESS_CONTEXTS as readonly string[]).includes(valor);
}

/**
 * Sugestoes iniciais por contexto. Deliberadamente MAGRAS: eu sei o nome
 * dos negocios e, de um deles, a area — inventar objetivo e palavras-chave
 * detalhadas para os outros seria chutar, e um chute aqui vira instrucao
 * dentro do prompt de triagem.
 *
 * O usuario edita tudo; isto so evita a tela em branco.
 */
export interface BusinessDefaults {
  calibration: TriageCalibration;
  urgentKeywords: string[];
  objectiveHint: string;
}

const CONSERVADOR_DE_NEGOCIO: Omit<BusinessDefaults, 'objectiveHint' | 'urgentKeywords'> = {
  // Caixa de negocio erra para o lado de mostrar: esconder o primeiro
  // e-mail de um cliente novo e um dano que voce nunca fica sabendo.
  calibration: 'CONSERVATIVE',
};

export const BUSINESS_DEFAULTS: Record<BusinessContext, BusinessDefaults> = {
  Unitedcom: {
    ...CONSERVADOR_DE_NEGOCIO,
    urgentKeywords: [],
    objectiveHint: 'O que você não pode perder nesta caixa?',
  },
  'Cordex.AI': {
    ...CONSERVADOR_DE_NEGOCIO,
    urgentKeywords: [],
    objectiveHint: 'O que você não pode perder nesta caixa?',
  },
  'Brand.co': {
    ...CONSERVADOR_DE_NEGOCIO,
    // O unico contexto cuja area voce me disse (palestras/treinamentos).
    // Ainda assim sao sugestoes: apague o que nao usar.
    urgentKeywords: ['palestra', 'treinamento', 'disponibilidade', 'agenda', 'proposta', 'cachê'],
    objectiveHint: 'Ex.: não perder convite para palestra nem pedido de proposta',
  },
  EmpreendaSim: {
    ...CONSERVADOR_DE_NEGOCIO,
    urgentKeywords: [],
    objectiveHint: 'O que você não pode perder nesta caixa?',
  },
  Outros: {
    calibration: 'BALANCED',
    urgentKeywords: [],
    objectiveHint: 'O que essa caixa recebe e o que importa nela?',
  },
  Pessoais: {
    // Caixa pessoal aguenta filtro mais agressivo: e cheia de newsletter, e
    // o custo de esconder uma e baixo.
    calibration: 'AGGRESSIVE',
    urgentKeywords: [],
    objectiveHint: 'Ex.: cobranças e coisas de família não podem passar batido',
  },
};

/**
 * Normaliza uma lista digitada pelo usuario (separada por virgula ou quebra
 * de linha) para o array que vai ao banco e ao prompt.
 *
 * Funcao pura e testada: um duplicado ou espaco solto aqui vira ruido
 * dentro do prompt de triagem de toda mensagem daquela caixa.
 */
export function parseList(bruto: string): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];

  for (const parte of bruto.split(/[,\n;]/)) {
    const limpo = parte.trim().toLowerCase();
    if (!limpo || vistos.has(limpo)) continue;
    vistos.add(limpo);
    saida.push(limpo);
  }
  return saida;
}

/** Formata de volta para a textarea, uma entrada por linha. */
export function formatList(lista: unknown): string {
  return Array.isArray(lista) ? (lista as string[]).join('\n') : '';
}
