import { prisma } from '@/lib/db';
import { baixarMidiaTwilio } from './midia';
import { lerCobrancaDePdf, type CobrancaDePdf } from './pdf-cobranca';
import { lerComprovanteDeImagem } from './imagem';
import { valorCabe } from './mensagem';

/**
 * O arquivo que chegou vira proposta — PDF ou imagem.
 * Ver docs/11-whatsapp.md
 *
 * Etapa SEPARADA de `registrarMensagem` de propósito, e é o mesmo princípio
 * que já valia para o texto: **registrar o que chegou nunca falha por causa
 * da interpretação**. A mensagem é gravada primeiro; ler o arquivo vem
 * depois e, se der errado, a linha continua lá com o motivo escrito.
 *
 * O binário nunca é guardado: é lido em memória e descartado. O que fica no
 * banco é o valor extraído e a referência que já existia.
 */

export interface ResultadoEnriquecimento {
  cobranca?: CobrancaDePdf;
  /** O valor que a legenda dizia, quando ela dizia algo diferente. */
  valorDaLegenda?: number;
}

/** É um PDF, pelo que o provedor declarou? A checagem de verdade é o byte. */
function pareceDocumentoPdf(kind: string, mime: string | null): boolean {
  if (kind !== 'DOCUMENT') return false;
  return (mime ?? '').toLowerCase().includes('pdf');
}

function pareceImagem(kind: string, mime: string | null): boolean {
  return kind === 'IMAGE' || (mime ?? '').toLowerCase().startsWith('image/');
}

export async function enriquecerMidia(
  mensagemId: string,
  agora = new Date(),
): Promise<ResultadoEnriquecimento | undefined> {
  const msg = await prisma.inboxMessage.findUnique({
    where: { id: mensagemId },
    select: {
      id: true,
      kind: true,
      mediaId: true,
      mediaMimeType: true,
      proposedAmountCents: true,
      proposedDescription: true,
      status: true,
    },
  });
  const ehPdf = pareceDocumentoPdf(msg?.kind ?? '', msg?.mediaMimeType ?? null);
  const ehImagem = pareceImagem(msg?.kind ?? '', msg?.mediaMimeType ?? null);
  if (!msg?.mediaId || (!ehPdf && !ehImagem)) return undefined;

  const baixado = await baixarMidiaTwilio(msg.mediaId, {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  });
  if (!baixado.ok) {
    await prisma.inboxMessage.update({
      where: { id: msg.id },
      data: { errorMessage: `Não consegui ler o arquivo: ${baixado.erro}` },
    });
    return { cobranca: { motivo: baixado.erro } };
  }

  // O PDF é lido por aritmética (texto + dígito verificador); a imagem passa
  // pelo modelo. São confianças diferentes, e a resposta diz qual foi.
  const cobranca: CobrancaDePdf = ehPdf
    ? await lerCobrancaDePdf(baixado.bytes, agora)
    : await (async () => {
        const foto = await lerComprovanteDeImagem(baixado.bytes, msg.mediaMimeType ?? baixado.contentType, agora);
        return {
          amountCents: foto.amountCents,
          vencimento: foto.data,
          descricao: foto.descricao,
          instrumento: foto.dvConfere !== undefined ? ('BOLETO' as const) : undefined,
          dvConfere: foto.dvConfere,
          direcao: foto.direcao,
          confianca: foto.confianca,
          deFoto: true,
          motivo: foto.motivo,
        };
      })();

  // Mesma trava do texto: uma linha digitável corrompida pode render um
  // número que a coluna não aceita, e gravar isso derruba o webhook.
  if (!valorCabe(cobranca.amountCents)) {
    await prisma.inboxMessage.update({
      where: { id: msg.id },
      data: { errorMessage: cobranca.motivo ?? 'Não achei valor no PDF.' },
    });
    return { cobranca };
  }

  // A legenda tem precedência: é o que VOCÊ escreveu de propósito, e pode
  // ser pagamento parcial ou com desconto. Mas a divergência é informação —
  // some para a resposta contar, em vez de sumir.
  const daLegenda = msg.proposedAmountCents ?? undefined;
  const valorFinal = daLegenda ?? cobranca.amountCents;

  await prisma.inboxMessage.update({
    where: { id: msg.id },
    data: {
      status: 'PROPOSED',
      proposedAmountCents: valorFinal,
      // Boleto e PIX são sempre saída: são coisa a pagar.
      // Boleto e PIX sao sempre saida; uma foto pode ser comprovante de
      // RECEBIMENTO, e forcar saida inverteria o sinal do seu caixa.
      proposedDirection: cobranca.direcao ?? 'SAIDA',
      proposedDescription: msg.proposedDescription ?? cobranca.descricao ?? null,
      proposedDate: cobranca.vencimento ?? undefined,
      // Dígito verificador que fecha é o mais perto de certeza que este app
      // chega; frase digitada nunca passa de palpite bem informado.
      confidence: cobranca.confianca ?? (cobranca.dvConfere ? 0.95 : 0.6),
      reason: cobranca.deFoto
        ? `Lido de uma foto${cobranca.dvConfere ? ', dígitos conferem' : ''}`
        : cobranca.dvConfere
          ? `${cobranca.instrumento === 'PIX' ? 'PIX' : 'Boleto'} lido do PDF, dígitos conferem`
          : `${cobranca.instrumento === 'PIX' ? 'PIX' : 'Boleto'} lido do PDF, dígitos não fecham`,
      errorMessage: null,
    },
  });

  return {
    cobranca,
    valorDaLegenda: daLegenda !== undefined && daLegenda !== cobranca.amountCents ? daLegenda : undefined,
  };
}
