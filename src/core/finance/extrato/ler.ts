import { lerCsv } from './csv';
import { lerOfx, pareceOfx } from './ofx';
import type { ExtratoLido } from './types';

/**
 * Porta de entrada: bytes → extrato lido, seja qual for o formato.
 *
 * A decodificacao importa mais do que parece. OFX de banco brasileiro vem
 * quase sempre em ISO-8859-1 (o cabecalho diz `CHARSET:1252`), e ler isso
 * como UTF-8 transforma "Padaria São João" em "Padaria S�o Jo�o" — o que
 * depois quebra a normalizacao e, pior, a conciliacao por nome.
 */

function decodificar(bytes: Uint8Array): string {
  // BOM UTF-8: confianca total.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }

  // Tenta UTF-8 estrito; se tiver byte invalido, e Latin-1.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('iso-8859-1').decode(bytes);
  }
}

export function lerExtrato(bytes: Uint8Array): ExtratoLido {
  const texto = decodificar(bytes);
  return pareceOfx(texto) ? lerOfx(texto) : lerCsv(texto);
}
