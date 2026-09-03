import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { DEFAULT_BILL_MODEL, extractDeterministic } from '@/core/finance/extractor';
import { nomeDoBanco } from '@/core/finance/bancos';
import { envOu } from '@/lib/env';
import { valorCabe } from './mensagem';

/**
 * Ler uma foto de comprovante. Ver docs/11-whatsapp.md
 *
 * O modelo LÊ; ele não decide. E há um detalhe que muda a confiança inteira:
 * quando a foto tem uma **linha digitável**, o modelo só transcreve os
 * dígitos e quem confere é o **dígito verificador** — a mesma aritmética que
 * já valida boleto vindo de e-mail. Nesse caso a leitura deixa de ser
 * palpite e passa a ser verificada.
 *
 * Sem linha digitável (comprovante de PIX, recibo, cupom), sobra a leitura
 * do modelo, e ela é declarada como tal: confiança limitada por construção,
 * e a resposta diz que veio de foto.
 */

/** Formatos que a API aceita. WhatsApp manda JPEG quase sempre. */
const TIPOS = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * 4 MB de arquivo. Foto de celular passa longe disso, e o webhook tem 30s
 * para responder — imagem grande vira base64 maior ainda e estoura o tempo
 * antes de estourar qualquer limite da API.
 */
export const MAX_BYTES_IMAGEM = 4 * 1024 * 1024;

/**
 * Teto da confiança de uma leitura sem dígito verificador.
 *
 * Nunca 1. Uma foto lida é a fonte mais fraca que este app aceita: pior que
 * uma frase que você digitou (você sabe o que quis dizer) e muito pior que
 * um código com DV. Declarar isso é o que faz você conferir antes de lançar.
 */
export const TETO_SEM_DV = 0.7;

const LeituraSchema = z.object({
  /** Isto é um comprovante, recibo, boleto ou fatura? */
  ehComprovante: z.boolean(),
  /** Valor principal em centavos. Null quando a imagem não mostra. */
  amountCents: z.number().int().nullable(),
  /** `ENTRADA` quando o documento diz recebimento; `SAIDA` para pagamento. */
  direcao: z.enum(['ENTRADA', 'SAIDA']).nullable(),
  /** Quem recebeu (ou pagou). Nome, não CNPJ. */
  contraparte: z.string().nullable(),
  /** ISO `YYYY-MM-DD` da data mostrada. Null quando não aparece. */
  data: z.string().nullable(),
  /**
   * A linha digitável do boleto, SÓ DÍGITOS, quando ela aparece legível.
   * É o único campo em que o modelo transcreve em vez de interpretar.
   */
  linhaDigitavel: z.string().nullable(),
  /** Uma frase curta explicando o que foi lido, para você conferir. */
  motivo: z.string(),
});

const SISTEMA = [
  'Você lê UMA imagem de documento financeiro brasileiro e devolve os campos pedidos.',
  '',
  'Regras:',
  '- Transcreva, não deduza. Campo que não aparece na imagem é null.',
  '- Valor em CENTAVOS: "R$ 1.234,56" é 123456.',
  '- Comprovante de pagamento e boleto são SAIDA. Comprovante de recebimento é ENTRADA.',
  '- linhaDigitavel: só quando a sequência longa de dígitos estiver legível.',
  '  Copie os dígitos exatamente, sem pontos nem espaços. Na dúvida, null.',
  '- Se a imagem não for documento financeiro, ehComprovante = false.',
].join('\n');

export interface LeituraDeImagem {
  amountCents?: number;
  direcao?: 'ENTRADA' | 'SAIDA';
  descricao?: string;
  data?: Date;
  /** Confiança já limitada: 0,95 com DV que fecha, no máximo 0,7 sem. */
  confianca: number;
  /** O DV da linha transcrita fechou? `undefined` quando não havia linha. */
  dvConfere?: boolean;
  motivo?: string;
}

/** ISO `YYYY-MM-DD` → data ancorada ao meio-dia, para não escorregar de fuso. */
function paraData(iso: string | null): Date | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [a, m, d] = iso.split('-').map(Number);
  const data = new Date(Date.UTC(a!, m! - 1, d!, 15, 0, 0));
  return Number.isNaN(data.getTime()) ? undefined : data;
}

export async function lerComprovanteDeImagem(
  bytes: Uint8Array,
  mimeType: string | undefined,
  agora = new Date(),
): Promise<LeituraDeImagem> {
  const tipo = (mimeType ?? '').toLowerCase().split(';')[0]!.trim();
  if (!TIPOS.has(tipo)) return { confianca: 0, motivo: `Não sei ler ${tipo || 'este formato'}.` };
  if (bytes.byteLength === 0) return { confianca: 0, motivo: 'Imagem vazia.' };
  if (bytes.byteLength > MAX_BYTES_IMAGEM) {
    return { confianca: 0, motivo: `Imagem grande demais (${Math.round(bytes.byteLength / 1024 / 1024)}MB).` };
  }

  let lido: z.infer<typeof LeituraSchema>;
  try {
    // Dentro do try: sem `ANTHROPIC_API_KEY` o construtor lança, e uma foto
    // não pode derrubar o webhook — o Twilio reentregaria para sempre.
    const client = new Anthropic();
    const modelo = envOu(process.env.BILL_MODEL, DEFAULT_BILL_MODEL);
    const resposta = await client.messages.parse({
      model: modelo,
      max_tokens: 2000,
      // Transcrever campo de documento é trabalho de rotina, e isto roda
      // dentro do webhook: esforço baixo mantém a resposta dentro do tempo.
      output_config: { effort: 'low', format: zodOutputFormat(LeituraSchema) },
      system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: tipo as 'image/jpeg', data: Buffer.from(bytes).toString('base64') },
            },
            { type: 'text', text: 'Leia este documento.' },
          ],
        },
      ],
    });
    if (!resposta.parsed_output) return { confianca: 0, motivo: 'O modelo não devolveu o formato esperado.' };
    lido = resposta.parsed_output;
  } catch {
    // Sem detalhe do erro: a mensagem sai para fora do app.
    return { confianca: 0, motivo: 'Não consegui ler a imagem agora.' };
  }

  return interpretarLeitura(lido, agora);
}

export type LeituraDoModelo = z.infer<typeof LeituraSchema>;

/**
 * O que a leitura do modelo SIGNIFICA — separado de quem a produziu.
 *
 * Puro de propósito: é aqui que mora a decisão que importa (o dígito
 * verificador manda no modelo, e não o contrário), e essa decisão precisa
 * ser testável sem chave de API e sem rede.
 */
export function interpretarLeitura(lido: LeituraDoModelo, agora = new Date()): LeituraDeImagem {
  if (!lido.ehComprovante) {
    return { confianca: 0, motivo: 'A imagem não parece um comprovante, boleto ou recibo.' };
  }

  // A virada de confiança: se veio linha digitável, quem decide é a
  // aritmética do DV — não o modelo, e não eu.
  const digitos = (lido.linhaDigitavel ?? '').replace(/\D/g, '');
  const doCodigo =
    digitos.length >= 44
      ? extractDeterministic({ id: 'imagem', body: digitos, receivedAt: agora, hasAttachments: false }, agora)
      : undefined;
  const boleto = doCodigo?.boleto ?? undefined;

  const doModelo = lido.amountCents ?? undefined;
  const amountCents = boleto?.checksumValid && boleto.amountCents ? boleto.amountCents : doModelo;

  if (!valorCabe(amountCents)) {
    return { confianca: 0, motivo: lido.motivo || 'Não achei um valor na imagem.' };
  }

  const banco = boleto?.bankCode ? nomeDoBanco(boleto.bankCode) : undefined;

  return {
    amountCents,
    // Boleto é sempre coisa a pagar; sem boleto, vale o que o documento diz.
    direcao: boleto ? 'SAIDA' : (lido.direcao ?? 'SAIDA'),
    descricao: boleto ? (banco ? `Boleto ${banco}` : 'Boleto') : (lido.contraparte ?? undefined),
    data: boleto?.dueDate ?? paraData(lido.data),
    confianca: boleto?.checksumValid ? 0.95 : TETO_SEM_DV,
    dvConfere: boleto ? boleto.checksumValid : undefined,
    motivo: lido.motivo || undefined,
  };
}
