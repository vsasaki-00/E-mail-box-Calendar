/**
 * Rotulos de exibicao da triagem.
 *
 * Modulo proprio, sem importar nada, de proposito: a lista de itens e a
 * barra de selecao multipla precisam dos mesmos rotulos, e quando um
 * importava do outro nascia um ciclo — na inicializacao o mapa chegava
 * `undefined` e os selects apareciam vazios. Um ponto neutro quebra o ciclo
 * e mantem uma unica fonte para os nomes.
 *
 * As chaves sao os valores dos enums TriageCategory e TriagePriority; o
 * teste em categorias.test.ts falha se divergirem do banco.
 */

export const CATEGORIA_LABEL: Record<string, string> = {
  COBRANCA: 'cobrança',
  NEEDS_REPLY: 'precisa resposta',
  INFORMATIVE: 'informativo',
  PROMOTIONAL: 'promocional',
  SPAM: 'spam',
  DISPOSABLE: 'descartável',
};

export const PRIORIDADE_LABEL: Record<string, string> = {
  URGENT: 'urgente',
  HIGH: 'alta',
  NORMAL: 'normal',
  LOW: 'baixa',
};
