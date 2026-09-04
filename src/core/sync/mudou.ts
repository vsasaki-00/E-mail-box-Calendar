/**
 * O que já está no banco é igual ao que eu ia gravar?
 *
 * Existe por causa de uma conta simples. Uma página de 25 mensagens custava
 * 104 consultas — quatro por mensagem, escrevendo TODAS elas mesmo quando
 * nada tinha mudado. Num banco de 5 ms isso passa despercebido; num de 583 ms
 * são 61 segundos, e a plataforma corta a função aos 60. Um sync incremental
 * de uma caixa parada, que devia custar quase nada, custava o mesmo que uma
 * carga inicial.
 *
 * A regra fica aqui, pura e testada, porque errar nela é o pior tipo de erro:
 * um campo esquecido na comparação vira dado velho na tela para sempre, e
 * silenciosamente.
 */

/**
 * `undefined` é "não tenho opinião", `null` é "grave nulo".
 *
 * A distinção é do Prisma: `campo: undefined` num `update` significa NÃO
 * TOQUE, e `campo: null` significa apague. Tratar os dois como a mesma coisa
 * geraria escrita à toa (no primeiro caso) ou deixaria de apagar (no segundo).
 */
export function mesmoValor(novo: unknown, atual: unknown): boolean {
  // "Não tenho opinião" nunca é motivo para escrever.
  if (novo === undefined) return true;

  if (novo === atual) return true;

  if (novo instanceof Date || atual instanceof Date) {
    if (!(novo instanceof Date) || !(atual instanceof Date)) return false;
    return novo.getTime() === atual.getTime();
  }

  if (novo === null) return atual === null || atual === undefined;
  if (atual === null || atual === undefined) return false;

  // Json do Prisma (listas de e-mail, rótulos, participantes). A ordem
  // importa: ela vem do provedor e é o que gravamos.
  if (typeof novo === 'object' || typeof atual === 'object') {
    return JSON.stringify(novo) === JSON.stringify(atual);
  }

  return false;
}

/**
 * Vale a pena gravar `novo` por cima de `atual`?
 *
 * Compara SÓ as chaves de `novo` — o que não vai ser escrito não pode
 * justificar uma escrita.
 */
export function precisaGravar(
  novo: Record<string, unknown>,
  atual: Record<string, unknown>,
): boolean {
  for (const chave of Object.keys(novo)) {
    if (!mesmoValor(novo[chave], atual[chave])) return true;
  }
  return false;
}
