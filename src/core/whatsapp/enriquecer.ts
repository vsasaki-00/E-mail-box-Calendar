import { prisma } from '@/lib/db';
import { baixarMidiaTwilio } from './midia';
import { lerCobrancaDePdf, type CobrancaDePdf } from './pdf-cobranca';
import { valorCabe } from './mensagem';

/**
 * O PDF que chegou vira proposta. Ver docs/11-whatsapp.md
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

export async function enriquecerComPdf(
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
  if (!msg?.mediaId || !pareceDocumentoPdf(msg.kind, msg.mediaMimeType)) return undefined;

  const baixado = await baixarMidiaTwilio(msg.mediaId, {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  });
  if (!baixado.ok) {
    await prisma.inboxMessage.update({
      where: { id: msg.id },
      data: { errorMessage: `Não consegui ler o PDF: ${baixado.erro}` },
    });
    return { cobranca: { motivo: baixado.erro } };
  }

  const cobranca = await lerCobrancaDePdf(baixado.bytes, agora);

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
      proposedDirection: 'SAIDA',
      proposedDescription: msg.proposedDescription ?? cobranca.descricao ?? null,
      proposedDate: cobranca.vencimento ?? undefined,
      // Dígito verificador que fecha é o mais perto de certeza que este app
      // chega; frase digitada nunca passa de palpite bem informado.
      confidence: cobranca.dvConfere ? 0.95 : 0.6,
      reason: cobranca.dvConfere
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
