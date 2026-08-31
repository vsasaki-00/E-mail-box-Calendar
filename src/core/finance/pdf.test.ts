import { describe, expect, it } from 'vitest';
import {
  extractFromAttachments,
  extractPdfText,
  looksLikePdf,
  MAX_PDF_BYTES,
  selectPdfAttachments,
  type AttachmentLike,
} from './pdf';

/**
 * Constroi um PDF minimo e valido, em ASCII, com o texto extraivel.
 *
 * Gerar em vez de guardar um binario no repositorio deixa o teste
 * auto-explicativo: da para ver exatamente o que o PDF contem.
 */
function makePdf(linhas: string[]): Uint8Array {
  const conteudo = linhas
    .map(
      (l, i) =>
        `BT /F1 11 Tf 50 ${760 - i * 18} Td (${l.replace(/([()\\])/g, '\\$1')}) Tj ET`,
    )
    .join('\n');

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

const LINHA = '34191.79001 01043.510047 91020.150008 8 89950000015000';

const BOLETO_PDF = makePdf([
  'FORNECEDOR S/A - CNPJ 12.345.678/0001-90',
  'Boleto referente a agosto de 2026',
  'Valor total: R$ 150,00',
  'Vencimento: 24/05/2022',
  LINHA,
]);

function anexo(over: Partial<AttachmentLike> = {}): AttachmentLike {
  return {
    filename: 'boleto.pdf',
    mimeType: 'application/pdf',
    size: BOLETO_PDF.length,
    data: BOLETO_PDF,
    ...over,
  };
}

describe('looksLikePdf — confia na assinatura, não no nome', () => {
  it('reconhece um PDF de verdade', () => {
    expect(looksLikePdf(BOLETO_PDF)).toBe(true);
  });

  it('rejeita conteúdo que só se chama .pdf', () => {
    // O mimetype e a extensão vêm de quem mandou o e-mail. Alimentar o
    // parser com o que o remetente disser que é um PDF é confiar em
    // desconhecido.
    expect(looksLikePdf(new Uint8Array(Buffer.from('MZ\x90\x00 executável')))).toBe(false);
    expect(looksLikePdf(new Uint8Array(Buffer.from('<html>')))).toBe(false);
  });

  it('rejeita buffer curto demais sem estourar', () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});

describe('extractPdfText', () => {
  it('extrai o texto, e a linha digitável sobrevive à formatação', async () => {
    // O que importa: o PDF preserva os pontos e espaços da linha, então o
    // parser de boleto acha depois.
    const resultado = await extractPdfText(BOLETO_PDF);

    expect(resultado.error).toBeUndefined();
    expect(resultado.text).toContain('R$ 150,00');
    expect(resultado.text).toContain('Vencimento: 24/05/2022');
    expect(resultado.text.replace(/\s+/g, ' ')).toContain(LINHA);
  });

  it('NÃO lança em PDF corrompido — devolve o motivo', async () => {
    // Um anexo problemático não pode derrubar a extração da cobrança
    // inteira; ela ainda aparece com o que deu para ler do corpo.
    const corrompido = new Uint8Array(Buffer.from('%PDF-1.4\nlixo que não é PDF'));
    const resultado = await extractPdfText(corrompido);

    expect(resultado.error).toBeDefined();
    expect(resultado.text).toBe('');
  });

  it('recusa arquivo grande demais sem carregar', async () => {
    const gigante = new Uint8Array(MAX_PDF_BYTES + 1);
    gigante.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const resultado = await extractPdfText(gigante);

    expect(resultado.error).toContain('grande demais');
  });

  it('recusa o que não é PDF', async () => {
    expect((await extractPdfText(new Uint8Array(Buffer.from('só texto')))).error).toContain(
      'não é um PDF',
    );
  });

  it('trata anexo vazio', async () => {
    expect((await extractPdfText(new Uint8Array())).error).toBe('Anexo vazio');
  });
});

describe('selectPdfAttachments', () => {
  it('deixa passar só o que é PDF de verdade', () => {
    const selecionados = selectPdfAttachments([
      anexo(),
      anexo({ filename: 'foto.jpg', data: new Uint8Array(Buffer.from('\xff\xd8\xff imagem')) }),
      // Nome de PDF, conteúdo de outra coisa.
      anexo({ filename: 'falso.pdf', data: new Uint8Array(Buffer.from('MZ executável')) }),
    ]);

    expect(selecionados).toHaveLength(1);
    expect(selecionados[0]?.filename).toBe('boleto.pdf');
  });
});

describe('extractFromAttachments', () => {
  it('junta o texto e diz de qual arquivo veio', async () => {
    // A marcação importa: o painel precisa poder dizer que a linha veio do
    // anexo, e não do corpo do e-mail.
    const resultado = await extractFromAttachments([anexo(), anexo({ filename: 'outro.pdf' })]);

    expect(resultado.sources).toEqual(['boleto.pdf', 'outro.pdf']);
    expect(resultado.text).toContain('R$ 150,00');
    expect(resultado.errors).toEqual([]);
  });

  it('um anexo ruim não impede os outros', async () => {
    const resultado = await extractFromAttachments([
      anexo({ filename: 'ruim.pdf', data: new Uint8Array(Buffer.from('%PDF-1.4\nlixo')) }),
      anexo({ filename: 'bom.pdf' }),
    ]);

    expect(resultado.sources).toEqual(['bom.pdf']);
    expect(resultado.errors[0]).toContain('ruim.pdf');
    expect(resultado.text).toContain('R$ 150,00');
  });

  it('sem anexo nenhum devolve vazio, sem erro', async () => {
    expect(await extractFromAttachments([])).toEqual({ text: '', sources: [], errors: [] });
  });
});

describe('o anexo do chamador sobrevive à leitura', () => {
  it('NÃO esvazia o buffer recebido', async () => {
    // O pdfjs se apropria do buffer que recebe e o deixa detached (length
    // vira 0). Encontrado porque `selectPdfAttachments` passou a devolver
    // vazio depois que outro teste leu o mesmo PDF — o bug apareceria como
    // "o anexo sumiu", bem longe da causa.
    const copia = makePdf(['Valor total: R$ 10,00']);
    const tamanhoAntes = copia.length;

    await extractPdfText(copia);

    expect(copia.length).toBe(tamanhoAntes);
  });

  it('o mesmo anexo pode ser lido duas vezes', async () => {
    const primeira = await extractPdfText(BOLETO_PDF);
    const segunda = await extractPdfText(BOLETO_PDF);

    expect(primeira.text).toContain('R$ 150,00');
    expect(segunda.text).toBe(primeira.text);
  });
});
