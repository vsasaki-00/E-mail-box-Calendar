/**
 * Normalizacao do corpo da mensagem para texto legivel.
 *
 * Os tres conectores devolvem formatos diferentes de `fetchMessageBody`:
 *  - Google: `{ text, html }` — text/plano quando existe na arvore MIME;
 *  - Microsoft: `{ html }` quando o contentType e html;
 *  - IMAP: `{ text }` contendo o RFC822 CRU, com cabecalhos.
 *
 * Sem esta camada o perfil de voz do Microsoft aprenderia tags HTML e o do
 * IMAP aprenderia cabecalhos de e-mail. Funcoes puras, sem rede.
 */

/** Linha de cabecalho (`Subject: x`) ou continuacao dobrada (comeca com espaco). */
const LINHA_DE_CABECALHO = /^([A-Za-z][A-Za-z0-9-]*:|[ \t])/;

/**
 * Um bloco de cabecalho de verdade tem varios campos. Exigir tres evita o
 * falso positivo obvio: um corpo que comeca com "Resumo: ..." seguido de
 * linha em branco perderia o primeiro paragrafo se bastasse uma linha.
 */
const MIN_LINHAS_DE_CABECALHO = 3;

/**
 * Corta os cabecalhos de uma mensagem RFC822 crua.
 *
 * Detecta pela FORMA DO BLOCO inteiro, nao so pela primeira linha: todas as
 * linhas antes da primeira linha em branco precisam parecer cabecalho, e
 * precisam ser pelo menos tres. Errar para o lado de nao cortar e o certo —
 * cortar um corpo legitimo perde texto que o perfil precisava.
 */
export function stripRawHeaders(texto: string): string {
  const normalizado = texto.replace(/\r\n/g, '\n');

  const separador = normalizado.indexOf('\n\n');
  if (separador === -1) return texto;

  const linhas = normalizado.slice(0, separador).split('\n');
  if (linhas.length < MIN_LINHAS_DE_CABECALHO) return texto;
  if (!linhas.every((linha) => LINHA_DE_CABECALHO.test(linha))) return texto;

  return normalizado.slice(separador + 2).trim();
}

const ENTIDADES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/**
 * Converte HTML em texto preservando as quebras de linha, que sao o que o
 * extrator de saudacao/despedida usa para achar comeco e fim da mensagem.
 */
export function htmlToText(html: string): string {
  let texto = html;

  // Estilo e script nao sao conteudo; precisam sair antes das tags.
  texto = texto.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Tags que representam quebra viram quebra de verdade.
  texto = texto.replace(/<br\s*\/?>/gi, '\n');
  texto = texto.replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n');

  texto = texto.replace(/<[^>]+>/g, '');

  for (const [entidade, valor] of Object.entries(ENTIDADES)) {
    texto = texto.split(entidade).join(valor);
  }
  texto = texto.replace(/&#(\d+);/g, (_, cod: string) => String.fromCharCode(Number(cod)));

  return texto
    .split('\n')
    .map((linha) => linha.trim())
    // Colapsa sequencias de linhas vazias, comuns em HTML de e-mail.
    .filter((linha, indice, todas) => linha.length > 0 || (todas[indice - 1] ?? '').length > 0)
    .join('\n')
    .trim();
}

/**
 * Escolhe e normaliza o melhor texto disponivel.
 *
 * Prefere text/plano: e o que o autor realmente digitou, sem a formatacao
 * que o cliente de e-mail injetou por cima.
 */
export function bestBodyText(corpo: { text?: string | null; html?: string | null }): string {
  if (corpo.text?.trim()) return stripRawHeaders(corpo.text).trim();
  if (corpo.html?.trim()) return htmlToText(corpo.html);
  return '';
}
