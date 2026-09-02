/**
 * Quando o ciclo pode começar mais um recurso.
 *
 * Separado do motor porque a regra tem uma exceção que é fácil de escrever
 * errado: o primeiro recurso roda SEMPRE, mesmo com o orçamento já vencido.
 * Um orçamento apertado transformando o ciclo em "não fiz nada" seria pior
 * que estourar o tempo — pelo menos o estouro aparece no log; um ciclo que
 * nunca avança não aparece em lugar nenhum.
 */
export function podeIniciarRecurso(
  jaIniciados: number,
  prazo: number | undefined,
  agora: number,
): boolean {
  if (jaIniciados === 0) return true;
  if (prazo === undefined) return true;
  return agora < prazo;
}
