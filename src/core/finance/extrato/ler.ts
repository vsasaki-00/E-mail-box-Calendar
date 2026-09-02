import { lerCsv } from './csv';
import { lerOfx, pareceOfx } from './ofx';
import { lerExtratoNubankPdf, pareceExtratoNubank } from './pdf-nubank';
import { extractPdfText, looksLikePdf } from '../pdf';
import type { ExtratoLido } from './types';

/**
 * Porta de entrada: bytes → extrato lido, seja qual for o formato.
 *
 * A decodificacao importa mais do que parece. OFX de banco brasileiro vem
 * quase sempre em ISO-8859-1 (o cabecalho diz `CHARSET:1252`), e ler isso
 * como UTF-8 transforma "Padaria São João" em "Padaria S�o Jo�o" — o que
 * depois quebra a normalizacao e, pior, a conciliacao por nome.
 *
 * PDF e reconhecido pela assinatura `%PDF-`, nunca pela extensao. So o
 * extrato de conta do Nubank e lido por enquanto: e o unico formato de PDF
 * cujo layout esta verificado contra um arquivo real.
 */

/** Extrato tem dezenas de paginas; os limites de boleto nao servem. */
const LIMITES_EXTRATO_PDF = { maxPages: 120, maxChars: 400_000 };

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

export async function lerExtrato(bytes: Uint8Array): Promise<ExtratoLido> {
  if (looksLikePdf(bytes)) {
    const pdf = await extractPdfText(bytes, LIMITES_EXTRATO_PDF);
    if (pdf.error) {
      return { formato: 'PDF', conta: {}, lancamentos: [], avisos: [`PDF ilegível: ${pdf.error}`] };
    }
    if (!pareceExtratoNubank(pdf.text)) {
      return {
        formato: 'PDF',
        conta: {},
        lancamentos: [],
        avisos: [
          'Este PDF não é um extrato de conta do Nubank — é o único PDF que sei ler por enquanto. ' +
            'Para outros bancos, exporte OFX ou CSV.',
        ],
      };
    }
    return lerExtratoNubankPdf(pdf.text);
  }

  const texto = decodificar(bytes);
  return pareceOfx(texto) ? lerOfx(texto) : lerCsv(texto);
}
