import { BUSINESS_CONTEXTS } from '@/core/triage/businesses';
import { CATEGORIAS } from '@/core/finance/categorias';

/**
 * Ler a resposta a uma pergunta feita na conversa. Ver docs/11-whatsapp.md
 *
 * A pergunta ("de qual negócio?") sai junto da confirmação, e responder é
 * opcional. O risco todo mora em confundir uma RESPOSTA com uma DESPESA
 * NOVA: `3` pode ser "Brand.co" ou "três reais".
 *
 * A regra é estreita de propósito, e erra para o lado de tratar como
 * despesa — porque uma despesa perdida some do painel, enquanto uma
 * resposta perdida você só repete.
 */

/** Menu numerado, para caber em poucas linhas de WhatsApp. */
export function menuNumerado(opcoes: readonly string[]): string {
  return opcoes.map((nome, i) => `${i + 1} ${nome}`).join(' · ');
}

export function menuDeNegocios(contextos: readonly string[] = BUSINESS_CONTEXTS): string {
  return menuNumerado(contextos);
}

export function menuDeCategorias(): string {
  return menuNumerado(CATEGORIAS);
}

/** Sem acento, minúsculo, sem pontuação — para comparar nome digitado. */
function achatar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Palavras que denunciam uma despesa, nunca uma resposta de menu. */
const CHEIRA_A_LANCAMENTO = /\b(paguei|pago|gastei|comprei|recebi|entrou|caiu|transferi|enviei|saiu|r\$|reais|pix|boleto)\b/i;

/**
 * O texto é a escolha de um negócio?
 *
 * Aceita o número do menu (`3`) e o nome escrito (`brand.co`, `Brand`,
 * `unitedcom`). Devolve `undefined` para qualquer outra coisa — e aí a
 * mensagem segue o caminho normal, como despesa.
 */
export function interpretarEscolhaDeNegocio(
  texto: string,
  contextos: readonly string[] = BUSINESS_CONTEXTS,
): string | undefined {
  return interpretarEscolha(texto, contextos);
}

/** A mesma leitura, para a pergunta de categoria — que vem no segundo passo. */
export function interpretarEscolhaDeCategoria(texto: string): string | undefined {
  return interpretarEscolha(texto, CATEGORIAS);
}

function interpretarEscolha(texto: string, contextos: readonly string[]): string | undefined {
  const limpo = texto.trim();

  // Uma resposta de menu é curta. Uma frase longa é outra coisa, mesmo que
  // comece com um número.
  if (!limpo || limpo.length > 40) return undefined;
  if (CHEIRA_A_LANCAMENTO.test(limpo)) return undefined;

  // Número solto, dentro do menu. `3,50` e `3 mil` não passam: têm mais
  // coisa depois do dígito.
  if (/^\d{1,2}$/.test(limpo)) {
    const n = Number(limpo);
    return n >= 1 && n <= contextos.length ? contextos[n - 1] : undefined;
  }

  const achatado = achatar(limpo);
  if (!achatado) return undefined;

  // Nome exato primeiro; só depois prefixo, e só quando ele identifica um
  // negócio SÓ. "Brand" resolve; um prefixo ambíguo não deve chutar.
  const exato = contextos.find((n) => achatar(n) === achatado);
  if (exato) return exato;

  const candidatos = contextos.filter((n) => achatar(n).startsWith(achatado));
  return candidatos.length === 1 ? candidatos[0] : undefined;
}

/**
 * O texto é só o nome do arquivo?
 *
 * O Twilio manda o nome do arquivo no corpo quando você anexa sem escrever
 * nada. Tratado como legenda, ele vira descrição (`7172622995683306 pdf`) e
 * seus dígitos viram candidatos a valor — foi de onde saiu o número que
 * estourou a coluna e derrubou o webhook.
 *
 * Um nome de arquivo é um token só, sem espaço, terminado em extensão
 * conhecida. Uma legenda de verdade com essa forma é implausível.
 */
export function pareceNomeDeArquivo(texto: string): boolean {
  return /^\S+\.(pdf|jpe?g|png|gif|webp|heic|ogg|opus|mp3|m4a|mp4|3gp|docx?|xlsx?|csv|ofx)$/i.test(texto.trim());
}
