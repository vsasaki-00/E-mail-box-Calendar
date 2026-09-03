import { BUSINESS_CONTEXTS } from '@/core/triage/businesses';

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

/** Menu numerado, para caber numa linha de WhatsApp. */
export function menuDeNegocios(): string {
  return BUSINESS_CONTEXTS.map((nome, i) => `${i + 1} ${nome}`).join(' · ');
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
export function interpretarEscolhaDeNegocio(texto: string): string | undefined {
  const limpo = texto.trim();

  // Uma resposta de menu é curta. Uma frase longa é outra coisa, mesmo que
  // comece com um número.
  if (!limpo || limpo.length > 40) return undefined;
  if (CHEIRA_A_LANCAMENTO.test(limpo)) return undefined;

  // Número solto, dentro do menu. `3,50` e `3 mil` não passam: têm mais
  // coisa depois do dígito.
  if (/^\d{1,2}$/.test(limpo)) {
    const n = Number(limpo);
    return n >= 1 && n <= BUSINESS_CONTEXTS.length ? BUSINESS_CONTEXTS[n - 1] : undefined;
  }

  const achatado = achatar(limpo);
  if (!achatado) return undefined;

  // Nome exato primeiro; só depois prefixo, e só quando ele identifica um
  // negócio SÓ. "Brand" resolve; um prefixo ambíguo não deve chutar.
  const exato = BUSINESS_CONTEXTS.find((n) => achatar(n) === achatado);
  if (exato) return exato;

  const candidatos = BUSINESS_CONTEXTS.filter((n) => achatar(n).startsWith(achatado));
  return candidatos.length === 1 ? candidatos[0] : undefined;
}
