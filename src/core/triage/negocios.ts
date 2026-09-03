/**
 * Regras de nome de negócio. Ver docs/07-agente-de-triagem.md
 *
 * Puro e sem Prisma: o nome ENTRA NO PROMPT de triagem, e a diferença entre
 * "Cordex.AI" e "cordex  ai " decide se duas caixas recebem o mesmo
 * contexto. Isso se testa sem banco.
 */

/** Cabe na tela, no menu do WhatsApp e dentro do prompt sem dominá-lo. */
export const MAX_NOME = 40;

/**
 * Encosta o nome no formato canônico, sem mudar o que você escreveu.
 *
 * Só espaço: acento, maiúscula e ponto são seus. "Cordex.AI" não vira
 * "cordex ai" — o nome é do dono, e normalizar demais apagaria a marca.
 */
export function normalizarNome(bruto: string): string {
  return bruto.replace(/\s+/g, ' ').trim().slice(0, MAX_NOME);
}

/** Para comparar dois nomes: sem acento, minúsculo, sem pontuação. */
export function chaveDeNome(nome: string): string {
  return normalizarNome(nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export type ErroDeNome = 'vazio' | 'curto' | 'duplicado' | 'so-simbolos';

/**
 * O nome serve?
 *
 * `existentes` são os nomes já usados; a comparação é pela chave, então
 * "Brand.co" e "brand co" colidem — e devem colidir, porque no prompt eles
 * seriam dois contextos para o mesmo negócio.
 */
export function validarNome(bruto: string, existentes: string[]): ErroDeNome | undefined {
  const nome = normalizarNome(bruto);
  if (!nome) return 'vazio';
  if (nome.length < 2) return 'curto';

  const chave = chaveDeNome(nome);
  // "..." e "---" passariam no comprimento e virariam um nome que nenhuma
  // comparação consegue casar depois.
  if (!chave) return 'so-simbolos';
  if (existentes.some((e) => chaveDeNome(e) === chave)) return 'duplicado';

  return undefined;
}

export function mensagemDoErro(erro: ErroDeNome): string {
  switch (erro) {
    case 'vazio':
      return 'Dê um nome ao negócio.';
    case 'curto':
      return 'Nome curto demais.';
    case 'so-simbolos':
      return 'O nome precisa ter letras ou números.';
    case 'duplicado':
      return 'Já existe um negócio com esse nome.';
  }
}

/**
 * Vale a pena migrar as linhas neste rename?
 *
 * Trocar "Brand.co" por "Brand.CO" muda a tela e não muda nada no banco —
 * mas as linhas guardam o texto, e deixá-las com a grafia antiga faria o
 * filtro por negócio devolver menos do que existe. Só um nome idêntico
 * dispensa a migração.
 */
export function precisaMigrar(antigo: string, novo: string): boolean {
  return normalizarNome(antigo) !== normalizarNome(novo);
}
