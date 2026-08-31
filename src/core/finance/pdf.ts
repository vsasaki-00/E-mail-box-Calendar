/**
 * Extracao de texto de PDF anexo. Ver docs/07-agente-de-triagem.md (5B)
 *
 * A lacuna mais provavel de morder no painel financeiro: boleto que chega
 * so como PDF anexo, com o corpo do e-mail dizendo apenas "segue em anexo".
 * Sem ler o anexo, a cobranca simplesmente nao existe para o sistema.
 *
 * Isto aqui e um parser de arquivo que veio de fora, entao vale a paranoia
 * de sempre: limite de tamanho, limite de paginas, verificacao do formato
 * real (e nao do nome do arquivo), e NUNCA lancar — um PDF corrompido nao
 * pode derrubar a extracao da cobranca inteira.
 */

/** Acima disso nem tenta: fatura com imagem tem dezenas de MB e nao ajuda. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** O que interessa num boleto esta na primeira pagina; 10 e folga generosa. */
export const MAX_PDF_PAGES = 10;
/** Texto alem disso e rodape juridico, nao dado de cobranca. */
export const MAX_PDF_CHARS = 40_000;

export interface PdfExtraction {
  text: string;
  pages: number;
  /** Por que nao deu, quando nao deu. Nunca excecao. */
  error?: string;
}

/**
 * Um PDF de verdade comeca com `%PDF-`.
 *
 * Checar a assinatura, e nao o `content-type` nem a extensao: os dois vem
 * de quem mandou o e-mail, e alimentar o parser com o que o remetente
 * disser que e um PDF e confiar em desconhecido.
 */
export function looksLikePdf(dados: Uint8Array): boolean {
  if (dados.length < 5) return false;
  // "%PDF-"
  return (
    dados[0] === 0x25 &&
    dados[1] === 0x50 &&
    dados[2] === 0x44 &&
    dados[3] === 0x46 &&
    dados[4] === 0x2d
  );
}

/**
 * Extrai o texto de um PDF.
 *
 * Nunca lanca: devolve `error` preenchido. Um anexo problematico deixa a
 * cobranca sem o dado do anexo, mas ela continua aparecendo no painel com
 * o que deu para ler do corpo.
 */
export async function extractPdfText(dados: Uint8Array): Promise<PdfExtraction> {
  if (dados.length === 0) return { text: '', pages: 0, error: 'Anexo vazio' };
  if (dados.length > MAX_PDF_BYTES) {
    return {
      text: '',
      pages: 0,
      error: `PDF grande demais (${Math.round(dados.length / 1024 / 1024)}MB)`,
    };
  }
  if (!looksLikePdf(dados)) {
    return { text: '', pages: 0, error: 'O anexo não é um PDF' };
  }

  try {
    // Import dinamico: o pdfjs e pesado, e a maioria das execucoes nao
    // encosta em anexo nenhum.
    const { extractText, getDocumentProxy } = await import('unpdf');

    // COPIA deliberada: o pdfjs se APROPRIA do buffer que recebe e o deixa
    // detached (`length` vira 0). Sem a copia, o anexo do chamador e
    // destruido — o segundo uso do mesmo Uint8Array veria um array vazio,
    // e o bug apareceria como "o anexo sumiu" bem longe daqui.
    const documento = await getDocumentProxy(dados.slice());

    const paginas = Math.min(documento.numPages, MAX_PDF_PAGES);
    const { text } = await extractText(documento, { mergePages: true });

    const bruto = Array.isArray(text) ? text.join('\n') : text;
    return {
      text: bruto.slice(0, MAX_PDF_CHARS),
      pages: paginas,
    };
  } catch (erro) {
    // PDF protegido por senha, corrompido, ou versao que o parser nao le.
    return {
      text: '',
      pages: 0,
      error: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

export interface AttachmentLike {
  filename: string;
  mimeType: string;
  size: number;
  data: Uint8Array;
}

/**
 * Quais anexos valem a pena abrir.
 *
 * Filtra por assinatura do arquivo E por tamanho — o nome e o mimetype sao
 * so pistas, e um deles mentir nao pode fazer o sistema abrir o que nao
 * deve.
 */
export function selectPdfAttachments(anexos: AttachmentLike[]): AttachmentLike[] {
  return anexos.filter((a) => a.data.length <= MAX_PDF_BYTES && looksLikePdf(a.data));
}

/**
 * Junta o texto dos PDFs anexos, marcando de qual arquivo veio cada trecho.
 *
 * A marcacao importa: o painel precisa poder dizer "esta linha digitavel
 * veio do anexo boleto.pdf", e nao do corpo do e-mail.
 */
export async function extractFromAttachments(
  anexos: AttachmentLike[],
): Promise<{ text: string; sources: string[]; errors: string[] }> {
  const partes: string[] = [];
  const sources: string[] = [];
  const errors: string[] = [];

  for (const anexo of selectPdfAttachments(anexos)) {
    const resultado = await extractPdfText(anexo.data);
    if (resultado.error) {
      errors.push(`${anexo.filename}: ${resultado.error}`);
      continue;
    }
    if (!resultado.text.trim()) continue;

    partes.push(resultado.text);
    sources.push(anexo.filename);
  }

  return { text: partes.join('\n\n'), sources, errors };
}
