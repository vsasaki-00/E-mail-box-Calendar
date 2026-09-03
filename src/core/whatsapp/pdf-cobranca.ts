import { nomeDoBanco } from '@/core/finance/bancos';
import { extractDeterministic } from '@/core/finance/extractor';
import { extractPdfText, looksLikePdf } from '@/core/finance/pdf';

/**
 * PDF que chegou por WhatsApp → proposta de lançamento.
 * Ver docs/11-whatsapp.md
 *
 * Reaproveita inteira a extração que já lê boleto e PIX dos anexos dos seus
 * e-mails. O ganho de ler PDF, e a razão de ele vir antes de imagem: a
 * linha digitável tem **dígito verificador**. O valor não é palpite de
 * modelo — ou o código fecha, ou o app diz que não fecha.
 *
 * Nada do binário é guardado. O arquivo é lido em memória e descartado; o
 * que fica no banco é o valor extraído e a referência que já existia.
 */

export interface CobrancaDePdf {
  amountCents?: number;
  vencimento?: Date;
  descricao?: string;
  instrumento?: 'BOLETO' | 'PIX';
  /** Os dígitos verificadores fecharam? Muda o tom da resposta. */
  dvConfere?: boolean;
  /** Por que não deu, quando não deu. */
  motivo?: string;
  /** Comprovante de recebimento existe: forçar saída inverteria o caixa. */
  direcao?: 'ENTRADA' | 'SAIDA';
  /** Quando quem leu foi o modelo, e não a aritmética. */
  confianca?: number;
  deFoto?: boolean;
  /** Só dígitos. Permite copiar e pagar pelo painel. */
  linhaDigitavel?: string;
}

/** Boleto costuma caber na primeira página; duas por folga, sem pagar caro. */
const LIMITES = { maxPages: 4, maxChars: 60_000 } as const;

export async function lerCobrancaDePdf(bytes: Uint8Array, agora = new Date()): Promise<CobrancaDePdf> {
  // Assinatura do arquivo, não o content-type: o tipo é o que o provedor
  // diz que é, e alimentar o parser com isso é confiar em quem mandou.
  if (!looksLikePdf(bytes)) return { motivo: 'O arquivo não é um PDF.' };

  const extraido = await extractPdfText(bytes, LIMITES);
  if (extraido.error) return { motivo: extraido.error };
  if (!extraido.text.trim()) {
    // PDF que é só imagem escaneada: tem página, não tem texto. Dizer isso
    // é melhor que "não achei valor", que sugere que o arquivo estava certo.
    return { motivo: 'O PDF não tem texto — parece um documento escaneado, e não leio imagem.' };
  }

  const achados = extractDeterministic(
    {
      id: 'whatsapp',
      body: extraido.text,
      receivedAt: agora,
      hasAttachments: false,
    },
    agora,
  );

  const boleto = achados.boleto;
  const pix = achados.pix;

  if (!boleto && !pix && achados.amountCents === null) {
    return { motivo: 'Não achei boleto, PIX nem valor no PDF.' };
  }

  const banco = boleto?.bankCode ? nomeDoBanco(boleto.bankCode) : undefined;
  const descricao = boleto
    ? banco
      ? `Boleto ${banco}`
      : 'Boleto'
    : pix?.merchantName
      ? `PIX ${pix.merchantName}`
      : pix
        ? 'PIX'
        : undefined;

  return {
    amountCents: achados.amountCents ?? undefined,
    vencimento: achados.dueDate ?? undefined,
    descricao,
    instrumento: boleto ? 'BOLETO' : pix ? 'PIX' : undefined,
    // Boleto tem os DVs da linha; PIX tem o CRC-16 do payload. Os dois
    // respondem a mesma pergunta: o número que li está íntegro?
    dvConfere: boleto ? boleto.checksumValid : pix ? pix.crcValid : undefined,
    linhaDigitavel: boleto?.digitableLine,
  };
}
