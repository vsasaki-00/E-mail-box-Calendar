/**
 * Leitura deterministica do "PIX copia e cola" (BR Code, padrao EMV).
 *
 * Ver docs/07-agente-de-triagem.md (fase 5B). Mesma razao do boleto: o
 * codigo PIX carrega a chave para onde o dinheiro vai. Um digito trocado
 * por um modelo e dinheiro na conta errada.
 *
 * O BR Code e TLV (tag, tamanho, valor) e termina com um CRC-16 sobre todo
 * o payload — entao da para conferir integridade sem depender de nada.
 */

export interface PixParsed {
  /** Payload completo, como veio. */
  payload: string;
  /** Chave PIX (tag 26, subtag 01), quando presente. */
  key: string | null;
  /** Valor em centavos (tag 54). `null` quando o QR nao fixa valor. */
  amountCents: number | null;
  /** Nome do beneficiario (tag 59). */
  merchantName: string | null;
  /** Cidade do beneficiario (tag 60). */
  merchantCity: string | null;
  /** Identificador da transacao (tag 62, subtag 05). */
  txid: string | null;
  /** O CRC-16 no fim do payload confere? */
  crcValid: boolean;
}

/**
 * CRC-16/CCITT-FALSE — polinomio 0x1021, valor inicial 0xFFFF, sem
 * reflexao. E o que o BR Code especifica.
 *
 * Verificado contra o vetor canonico do algoritmo: CRC("123456789") deve
 * dar 0x29B1. O teste garante isso, o que torna esta funcao confiavel
 * independentemente de eu ter um PIX real em maos.
 */
export function crc16ccitt(texto: string): number {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i += 1) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export interface TlvNode {
  tag: string;
  value: string;
}

/**
 * Percorre a estrutura TLV. Devolve o que conseguiu ler: um payload
 * truncado no meio nao pode fazer o parser inteiro falhar, senao um
 * e-mail mal formatado esconde a cobranca.
 */
export function parseTlv(payload: string): TlvNode[] {
  const nos: TlvNode[] = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const tamanho = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(tamanho)) break;
    const inicio = i + 4;
    if (inicio + tamanho > payload.length) break;
    nos.push({ tag, value: payload.slice(inicio, inicio + tamanho) });
    i = inicio + tamanho;
  }
  return nos;
}

function valorDaTag(nos: TlvNode[], tag: string): string | null {
  return nos.find((n) => n.tag === tag)?.value ?? null;
}

/** Um BR Code comeca com "000201" (payload format indicator). */
const INICIO = /000201/;
/** O CRC e sempre a ultima tag: "6304" + 4 digitos hexadecimais. */
const FIM = /6304[0-9A-Fa-f]{4}/;

/**
 * Extrai o primeiro BR Code encontrado no texto.
 *
 * `null` quando nao ha nada com forma de PIX — diferente de um PIX que
 * existe mas nao valida, que e devolvido com `crcValid: false`.
 */
export function parsePix(texto: string): PixParsed | null {
  // Tensao real: o e-mail quebra o payload em varias linhas, mas o BR Code
  // legitimamente contem ESPACOS (o nome do beneficiario na tag 59). Tirar
  // todo espaco em branco conserta a quebra de linha e quebra o nome.
  //
  // Como o CRC diz qual normalizacao esta certa, tenta as duas: primeiro a
  // conservadora (so quebras de linha), depois a agressiva. A primeira que
  // fecha o CRC vence; se nenhuma fechar, devolve a conservadora marcada
  // como invalida.
  const candidatos = [texto.replace(/[\r\n\t]+/g, ''), texto.replace(/\s+/g, '')];

  let primeiro: PixParsed | null = null;
  for (const candidato of candidatos) {
    const lido = lerBrCode(candidato);
    if (!lido) continue;
    if (lido.crcValid) return lido;
    primeiro ??= lido;
  }
  return primeiro;
}

function lerBrCode(limpo: string): PixParsed | null {
  const inicio = limpo.search(INICIO);
  if (inicio === -1) return null;

  const resto = limpo.slice(inicio);
  const fim = resto.match(FIM);
  if (!fim || fim.index === undefined) return null;

  const payload = resto.slice(0, fim.index + 8);
  // O CRC e calculado sobre o payload INCLUINDO "6304" e excluindo os
  // quatro digitos do proprio CRC.
  const esperado = crc16ccitt(payload.slice(0, -4));
  const lido = Number.parseInt(payload.slice(-4), 16);

  const nos = parseTlv(payload);
  const conta = valorDaTag(nos, '26') ?? valorDaTag(nos, '27');
  const chave = conta ? valorDaTag(parseTlv(conta), '01') : null;
  const adicional = valorDaTag(nos, '62');

  const valor = valorDaTag(nos, '54');
  const centavos = valor !== null ? Math.round(Number(valor) * 100) : null;

  return {
    payload,
    key: chave,
    // QR sem tag 54 e "valor a combinar" — devolver 0 viraria uma cobranca
    // de R$ 0,00 no painel.
    amountCents: centavos !== null && Number.isFinite(centavos) && centavos > 0 ? centavos : null,
    merchantName: valorDaTag(nos, '59')?.trim() ?? null,
    merchantCity: valorDaTag(nos, '60')?.trim() ?? null,
    txid: adicional ? valorDaTag(parseTlv(adicional), '05') : null,
    crcValid: esperado === lido,
  };
}
