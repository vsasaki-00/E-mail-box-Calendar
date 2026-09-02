import { createHash } from 'node:crypto';

/**
 * Normalizacao de descricao e impressao digital de lancamento.
 *
 * A descricao que o banco manda e feita para o extrato impresso, nao para
 * casar registros: "COMPRA CARTAO 15/08 SUPERMERCADO X ****1234" e
 * "COMPRA CARTAO 22/08 SUPERMERCADO X ****1234" sao o mesmo
 * estabelecimento, e a data e o final do cartao so atrapalham. A forma
 * normalizada e o que a conciliacao e as regras de categoria olham; a
 * original fica guardada intacta para auditoria.
 */

/** Ruido que todo banco brasileiro acrescenta e que nao identifica nada. */
const RUIDO = [
  // Datas embutidas: 15/08, 15/08/26, 15/08/2026
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g,
  // Final de cartao: ****1234, *1234, final 1234
  /\*+\s*\d{4}\b/g,
  /\bfinal\s+\d{4}\b/g,
  // Numeros longos: documento, autenticacao, protocolo
  /\b\d{6,}\b/g,
  // Horarios: 12:34, 12:34:56
  /\b\d{1,2}:\d{2}(:\d{2})?\b/g,
  // Parcela: 03/12, parc 3/12
  /\bparc(ela)?\.?\s*\d{1,2}\s*\/\s*\d{1,2}\b/g,
  // Prefixos operacionais que nao dizem QUEM
  /\b(compra|pagamento|pagto|pgto|transferencia|transf|debito|credito|envio|recebimento)\s+(no|de|em|com|via|por)?\s*(cartao|debito|credito|pix|ted|doc|boleto)?\b/g,
  /\b(pix|ted|doc)\s+(enviad[oa]|recebid[oa])\b/g,
];

/** Minusculas, sem acento, sem ruido, espacos unicos. */
export function normalizarDescricao(bruta: string): string {
  let texto = bruta
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  for (const padrao of RUIDO) texto = texto.replace(padrao, ' ');

  // Sobra so letra, numero e espaco. Pontuacao varia entre exportacoes
  // do mesmo banco e nao carrega identidade.
  texto = texto.replace(/[^a-z0-9\s]/g, ' ');
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * Impressao digital para deduplicacao.
 *
 * Com FITID, e ele: o banco garante que e estavel entre exportacoes, e e a
 * unica identidade que sobrevive a uma mudanca no nosso normalizador.
 *
 * Sem FITID (CSV), e o conjunto (dia, valor, descricao normalizada) mais um
 * contador de ocorrencia dentro do arquivo. O contador existe porque duas
 * compras identicas no mesmo dia sao comuns (dois cafes) e sem ele a
 * segunda sumiria como "duplicada".
 */
export function impressaoDigital(entrada: {
  fitId?: string;
  postedAt: Date;
  amountCents: number;
  normalized: string;
  ocorrencia: number;
}): string {
  if (entrada.fitId) return `fitid:${entrada.fitId}`;

  const dia = entrada.postedAt.toISOString().slice(0, 10);
  const base = `${dia}|${entrada.amountCents}|${entrada.normalized}|${entrada.ocorrencia}`;
  return `hash:${createHash('sha256').update(base).digest('hex').slice(0, 32)}`;
}

/** SHA-256 do arquivo inteiro, para "este arquivo ja subiu". */
export function hashDoArquivo(conteudo: Buffer | Uint8Array): string {
  return createHash('sha256').update(conteudo).digest('hex');
}
