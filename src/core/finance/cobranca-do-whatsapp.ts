import { prisma } from '@/lib/db';
import type { BillKind } from './types';
import { baixarMidiaTwilio } from '@/core/whatsapp/midia';
import { lerCobrancaDePdf } from '@/core/whatsapp/pdf-cobranca';

/**
 * Um boleto que chegou pelo WhatsApp vira **conta a pagar**.
 * Ver docs/10-financeiro.md
 *
 * Antes disto só havia um destino para uma proposta: virar lançamento. Mas
 * lançamento diz "o dinheiro SAIU" — e um boleto que vence dia 31 não saiu
 * nada ainda. Lançá-lo inflava a despesa do mês e, quando o extrato
 * chegasse, a mesma saída entrava de novo pela linha do banco.
 *
 * A cobrança é o registro certo: tem vencimento, aparece em "o que vence",
 * e o pagamento é casado depois pela conciliação — que é exatamente o que
 * já acontece com boleto detectado em e-mail.
 *
 * A cobrança pendura num `UnifiedItem`, como as de e-mail. Criar um item
 * sem mensagem é o que permite as duas origens conviverem na mesma tela
 * sem uma tabela paralela.
 */

export interface ResultadoCobranca {
  ok: boolean;
  erro?: string;
  comLinhaDigitavel?: boolean;
}

function tipoDaCobranca(reason: string | null): BillKind {
  const t = (reason ?? '').toLowerCase();
  if (t.includes('pix')) return 'PIX';
  if (t.includes('boleto')) return 'BOLETO';
  return 'OUTRO';
}

/**
 * Recupera a linha digitável relendo o PDF.
 *
 * Ela é lida no webhook mas não é guardada — não há coluna para isso na
 * mensagem. Reler aqui custa alguns segundos numa ação de tela (não no
 * webhook, onde o tempo é apertado) e é o que permite copiar e pagar pelo
 * painel. Falhar aqui só custa esse conforto: a cobrança nasce igual.
 */
async function linhaDigitavelDoAnexo(mediaId: string | null, mime: string | null) {
  if (!mediaId || !(mime ?? '').toLowerCase().includes('pdf')) return undefined;

  const baixado = await baixarMidiaTwilio(mediaId, {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  });
  if (!baixado.ok) return undefined;

  const cobranca = await lerCobrancaDePdf(baixado.bytes);
  return cobranca.linhaDigitavel;
}

export async function criarCobrancaDeMensagem(
  userId: string,
  mensagemId: string,
): Promise<ResultadoCobranca> {
  const msg = await prisma.inboxMessage.findFirst({
    where: { id: mensagemId, userId },
    select: {
      id: true,
      externalId: true,
      status: true,
      proposedAmountCents: true,
      proposedDescription: true,
      proposedDate: true,
      receivedAt: true,
      reason: true,
      mediaId: true,
      mediaMimeType: true,
    },
  });
  if (!msg) return { ok: false, erro: 'Mensagem não encontrada' };
  if (msg.status === 'ACCEPTED') return { ok: false, erro: 'Esta mensagem já foi resolvida' };
  if (!msg.proposedAmountCents) return { ok: false, erro: 'Sem valor: não dá para cobrar' };

  const linha = await linhaDigitavelDoAnexo(msg.mediaId, msg.mediaMimeType).catch(() => undefined);
  const dedupeKey = `whatsapp:${msg.externalId}`;

  try {
    await prisma.$transaction(async (tx) => {
      const item = await tx.unifiedItem.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey } },
        update: {},
        create: {
          userId,
          kind: 'MESSAGE',
          dedupeKey,
          title: msg.proposedDescription ?? 'Cobrança pelo WhatsApp',
          occurredAt: msg.receivedAt,
        },
        select: { id: true },
      });

      await tx.billExtraction.upsert({
        where: { unifiedItemId: item.id },
        update: {},
        create: {
          unifiedItemId: item.id,
          userId,
          amountCents: msg.proposedAmountCents,
          dueDate: msg.proposedDate,
          payee: msg.proposedDescription,
          kind: tipoDaCobranca(msg.reason),
          digitableLine: linha ?? null,
          // `INSTRUMENT` só quando há linha digitável: ela carrega dígito
          // verificador, e é o que separa dado conferido de leitura.
          source: linha ? 'INSTRUMENT' : 'USER',
          confidence: linha ? 0.95 : 0.8,
          isPayable: true,
          status: 'PENDING',
          reason: linha
            ? 'Boleto que você mandou pelo WhatsApp, com linha digitável conferida'
            : 'Cobrança que você mandou pelo WhatsApp',
        },
      });

      await tx.inboxMessage.update({
        where: { id: msg.id },
        data: { status: 'ACCEPTED', reason: 'Virou conta a pagar' },
      });
    });
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  return { ok: true, comLinhaDigitavel: Boolean(linha) };
}
