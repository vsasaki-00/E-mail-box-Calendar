/**
 * Desfazer uma importação de extrato. Ver docs/10-financeiro.md
 *
 * O `StatementImport` existe desde o começo para isto — o comentário no
 * schema diz "desfazer uma importação inteira quando ela vem errada" —, mas
 * a ação nunca tinha sido construída.
 *
 * Duas armadilhas moram aqui, e as duas destroem em silêncio:
 *
 *  1. A relação é `onDelete: SetNull`. Apagar só a importação deixaria os
 *     lançamentos no lugar, órfãos, sem nem a origem para explicá-los. Pior
 *     que não apagar: some o rastro e fica o dado.
 *  2. Você pode ter mexido em linhas dessa importação — categorizado,
 *     conciliado, anotado. Apagar tudo jogaria fora trabalho que o arquivo
 *     errado não fez.
 */

/** O mínimo de um lançamento para decidir se ele pode ser apagado. */
export interface LinhaParaDesfazer {
  id: string;
  categorySource: string | null;
  matchStatus: string;
  notes: string | null;
}

export interface PlanoDeExclusao {
  apagar: string[];
  /** Preservados, com o motivo — a tela precisa dizer por que ficaram. */
  preservados: { id: string; motivo: string }[];
}

/**
 * Por que esta linha sobrevive à exclusão?
 *
 * `undefined` = ninguém tocou nela, pode ir. A pergunta é sempre "houve
 * trabalho humano aqui?", nunca "o dado parece importante?".
 */
export function motivoParaPreservar(linha: LinhaParaDesfazer): string | undefined {
  // Categoria dada por REGRA ou por HEURISTICA é palpite do app; só USER é
  // você. Preservar palpite tornaria o desfazer inútil na prática.
  if (linha.categorySource === 'USER') return 'você definiu a categoria';
  if (linha.matchStatus === 'CONFIRMED') return 'você confirmou a conciliação';
  if (linha.matchStatus === 'REJECTED') return 'você recusou a conciliação';
  if (linha.notes?.trim()) return 'tem anotação sua';
  return undefined;
}

export function planejarExclusao(linhas: LinhaParaDesfazer[]): PlanoDeExclusao {
  const apagar: string[] = [];
  const preservados: { id: string; motivo: string }[] = [];

  for (const linha of linhas) {
    const motivo = motivoParaPreservar(linha);
    if (motivo) preservados.push({ id: linha.id, motivo });
    else apagar.push(linha.id);
  }

  return { apagar, preservados };
}

/** Resumo por motivo, para a tela dizer o que vai acontecer antes do clique. */
export function resumirPreservados(plano: PlanoDeExclusao): { motivo: string; quantas: number }[] {
  const contagem = new Map<string, number>();
  for (const p of plano.preservados) contagem.set(p.motivo, (contagem.get(p.motivo) ?? 0) + 1);
  return [...contagem]
    .map(([motivo, quantas]) => ({ motivo, quantas }))
    .sort((a, b) => b.quantas - a.quantas);
}
