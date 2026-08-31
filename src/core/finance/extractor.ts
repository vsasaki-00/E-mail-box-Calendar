import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { findBoletos, type BoletoParsed } from './boleto';
import { parsePix, type PixParsed } from './pix';
import { pickAmount, pickDueDate } from './text';
import type { BillExtraction, BillInput, BillKind } from './types';

/**
 * Extracao de cobrancas (fase 5B). Ver docs/07-agente-de-triagem.md
 *
 * Ordem de autoridade, e ela nao inverte:
 *  1. INSTRUMENTO (boleto/PIX) — carrega digito verificador. Manda.
 *  2. TEXTO rotulado ("Valor total: R$ ...", "Vencimento: ...").
 *  3. MODELO — so para o que sobrou, e com confianca limitada.
 *
 * O modelo nunca reescreve uma linha digitavel nem um valor que veio do
 * instrumento. Ele pode trocar um digito, e do lado do dinheiro isso e
 * irreversivel.
 */

const KINDS = ['BOLETO', 'PIX', 'FATURA', 'ASSINATURA', 'NOTA_FISCAL', 'OUTRO'] as const;

const ExtractionSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      /** Quem cobra. Nome da empresa, nao o endereco de e-mail. */
      payee: z.string().nullable(),
      kind: z.enum(KINDS),
      /** Em centavos, sem separador. Null quando o e-mail nao diz. */
      amountCents: z.number().int().nullable(),
      /** ISO `YYYY-MM-DD`. Null quando o e-mail nao diz. */
      dueDate: z.string().nullable(),
      /** Isto e mesmo uma cobranca a pagar? */
      isPayable: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

export type ExtractionResponse = z.infer<typeof ExtractionSchema>;

/** A costura que permite testar sem API. */
export interface BillModel {
  readonly name: string;
  extract(systemPrompt: string, userPrompt: string): Promise<ExtractionResponse>;
}

export const DEFAULT_BILL_MODEL = 'claude-opus-5';
/** Lote pequeno: aqui vai corpo de e-mail, nao so assunto. */
export const BILL_BATCH_SIZE = 8;
export const BILL_PROMPT_VERSION = 'fin-1';

/**
 * Quanto do corpo entra no prompt.
 *
 * Corta por duas razoes: custo (corpo inteiro de fatura tem paginas de
 * rodape) e privacidade (quanto menos sai, melhor). O que interessa —
 * valor, vencimento, quem cobra — esta no comeco.
 */
export const MAX_BODY_CHARS = 4000;

/** Teto de confianca quando so o modelo viu o dado. */
export const MODEL_ONLY_CONFIDENCE_CAP = 0.5;

export function buildBillSystemPrompt(): string {
  return [
    'Você extrai dados de cobranças (contas A PAGAR) de e-mails em português do Brasil.',
    '',
    'Contexto: são e-mails de fornecedores com faturas, boletos, cobranças de',
    'assinatura e notas fiscais. O objetivo é alimentar um painel de contas a pagar.',
    '',
    'Regras:',
    '- Extraia apenas o que está EXPLÍCITO no e-mail. Nunca deduza um valor ou',
    '  uma data que não está escrita — no lugar disso devolva null.',
    '- `amountCents` é o TOTAL a pagar em centavos (R$ 1.209,90 => 120990).',
    '  Se o e-mail lista itens e um total, use o total.',
    '- `dueDate` no formato YYYY-MM-DD. Se o e-mail dá só dia e mês, use o ano',
    '  que faz o vencimento cair no futuro próximo em relação à data de envio.',
    '- `payee` é quem está cobrando (nome da empresa), não quem paga.',
    '- `isPayable` é falso para recibo de pagamento já feito, confirmação de',
    '  compra, cobrança que VOCÊ emitiu, ou aviso sem valor a pagar.',
    '- `confidence` reflete o quanto o e-mail é explícito. Seja honesto:',
    '  confiança alta num palpite é pior do que confiança baixa.',
    '- `reason` em uma frase, dizendo de onde tirou o valor e o vencimento.',
  ].join('\n');
}

export function buildBillBatchPrompt(inputs: BillInput[]): string {
  return inputs
    .map((input) =>
      [
        `<email id="${input.id}">`,
        `De: ${input.fromName ?? ''} <${input.fromEmail ?? ''}>`,
        `Assunto: ${input.subject ?? '(sem assunto)'}`,
        `Recebido em: ${input.receivedAt.toISOString().slice(0, 10)}`,
        `Anexos: ${input.hasAttachments ? 'sim' : 'não'}`,
        '',
        input.body.slice(0, MAX_BODY_CHARS),
        '</email>',
      ].join('\n'),
    )
    .join('\n\n');
}

export function createAnthropicBillModel(options?: { apiKey?: string; model?: string }): BillModel {
  const model = options?.model ?? process.env.BILL_MODEL ?? DEFAULT_BILL_MODEL;
  const client = new Anthropic(options?.apiKey ? { apiKey: options.apiKey } : {});

  return {
    name: model,
    async extract(systemPrompt, userPrompt) {
      const response = await client.messages.parse({
        model,
        max_tokens: 8000,
        // Extracao estruturada de campo explicito e trabalho de rotina.
        output_config: { effort: 'low', format: zodOutputFormat(ExtractionSchema) },
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      });

      if (!response.parsed_output) {
        throw new Error('O modelo nao devolveu uma resposta no formato esperado');
      }
      return response.parsed_output;
    },
  };
}

// ---------------------------------------------------------------------------
// Camada deterministica
// ---------------------------------------------------------------------------

export interface DeterministicFindings {
  boleto: BoletoParsed | null;
  pix: PixParsed | null;
  amountCents: number | null;
  dueDate: Date | null;
  amountRaw: string | null;
  dueDateRaw: string | null;
}

/** O que da para saber do e-mail sem gastar uma chamada de modelo. */
export function extractDeterministic(input: BillInput, hoje = new Date()): DeterministicFindings {
  const boletos = findBoletos(input.body, hoje);
  const boleto = boletos.find((b) => b.checksumValid) ?? boletos[0] ?? null;
  const pix = parsePix(input.body);

  const valorTexto = pickAmount(input.body);
  const vencimentoTexto = pickDueDate(input.body, hoje);

  return {
    boleto,
    pix,
    amountCents: valorTexto?.cents ?? null,
    dueDate: vencimentoTexto?.date ?? null,
    amountRaw: valorTexto?.raw ?? null,
    dueDateRaw: vencimentoTexto?.raw ?? null,
  };
}

function kindFrom(achados: DeterministicFindings): BillKind | null {
  if (achados.boleto) return 'BOLETO';
  if (achados.pix) return 'PIX';
  return null;
}

/**
 * Junta as tres camadas numa extracao final.
 *
 * `doModelo` pode ser null: sem chave de API, ou quando o lote falhou. Uma
 * cobranca sem o modelo ainda vale — o instrumento sozinho ja da valor,
 * vencimento e para quem pagar.
 */
export function mergeExtraction(
  input: BillInput,
  achados: DeterministicFindings,
  doModelo: ExtractionResponse['results'][number] | null,
): BillExtraction {
  const warnings: string[] = [];
  const razoes: string[] = [];

  let amountCents: number | null = null;
  let dueDate: Date | null = null;
  let source: BillExtraction['source'] = 'MODEL';
  let confidence = 0;

  const { boleto, pix } = achados;

  // 1. Instrumento de pagamento.
  //
  // O gatilho e `fieldChecksumValid` (modulo 10), e nao `checksumValid`,
  // de proposito. O DV geral (modulo 11) nao pode ser verificado neste
  // ambiente — ver a ressalva em boleto.ts. Se ele estiver errado na minha
  // implementacao e eu o usasse como porta, TODO boleto real cairia
  // calado para o modelo, e o painel pareceria funcionar. Rebaixar a
  // confianca e avisar e um erro visivel; abandonar o instrumento em
  // silencio nao e.
  if (boleto) {
    if (!boleto.fieldChecksumValid) {
      warnings.push(
        'A linha digitável encontrada não fecha o dígito verificador dos campos — ' +
          'confira no e-mail original antes de pagar.',
      );
    } else {
      amountCents = boleto.amountCents;
      dueDate = boleto.dueDate;
      source = 'INSTRUMENT';
      confidence = boleto.generalChecksumValid ? 0.95 : 0.75;
      razoes.push('valor e vencimento lidos da própria linha digitável');

      if (!boleto.generalChecksumValid) {
        warnings.push(
          'O dígito verificador geral do código de barras não confere. Os campos ' +
            'da linha conferem, então ela provavelmente está íntegra — mas confira ' +
            'valor e vencimento no e-mail original antes de pagar.',
        );
      }
    }

    if (boleto.amountCents === null) {
      warnings.push('O boleto não traz valor no código (boleto sem valor definido).');
    }
  } else if (pix) {
    if (!pix.crcValid) {
      warnings.push(
        'O código PIX encontrado não fecha o CRC — pode estar truncado ou ' +
          'adulterado. Confira no e-mail original antes de pagar.',
      );
    } else if (pix.amountCents !== null) {
      amountCents = pix.amountCents;
      source = 'INSTRUMENT';
      confidence = 0.9;
      razoes.push('valor lido do próprio código PIX');
    }
    // O PIX nao carrega vencimento; ele vem do texto ou do modelo.
  }

  // 2. Texto rotulado, para o que o instrumento nao deu.
  if (amountCents === null && achados.amountCents !== null) {
    amountCents = achados.amountCents;
    source = source === 'INSTRUMENT' ? 'INSTRUMENT' : 'TEXT';
    confidence = Math.max(confidence, 0.6);
    razoes.push(`valor lido de "${achados.amountRaw}" no corpo`);
  }
  if (dueDate === null && achados.dueDate !== null) {
    dueDate = achados.dueDate;
    if (source !== 'INSTRUMENT') source = 'TEXT';
    confidence = Math.max(confidence, 0.6);
    razoes.push(`vencimento lido de "${achados.dueDateRaw}" no corpo`);
  }

  // 3. Modelo, so para o que sobrou — e com teto de confianca.
  if (doModelo) {
    if (amountCents === null && doModelo.amountCents !== null && doModelo.amountCents > 0) {
      amountCents = doModelo.amountCents;
      if (source !== 'INSTRUMENT' && source !== 'TEXT') source = 'MODEL';
      confidence = Math.max(confidence, Math.min(doModelo.confidence, MODEL_ONLY_CONFIDENCE_CAP));
      warnings.push('O valor não foi confirmado por boleto, PIX nem rótulo no corpo.');
    }
    if (dueDate === null && doModelo.dueDate) {
      const lida = new Date(`${doModelo.dueDate}T12:00:00.000Z`);
      if (!Number.isNaN(lida.getTime())) {
        dueDate = lida;
        if (source !== 'INSTRUMENT' && source !== 'TEXT') source = 'MODEL';
        confidence = Math.max(confidence, Math.min(doModelo.confidence, MODEL_ONLY_CONFIDENCE_CAP));
        warnings.push('O vencimento não foi confirmado por boleto nem rótulo no corpo.');
      }
    }
    razoes.push(doModelo.reason);
  } else {
    warnings.push('Extração sem o modelo: só o que boleto, PIX e rótulos no corpo permitiram ler.');
  }

  if (amountCents === null) warnings.push('Valor não identificado — abra o e-mail para conferir.');
  if (dueDate === null) warnings.push('Vencimento não identificado — abra o e-mail para conferir.');

  const kind = kindFrom(achados) ?? doModelo?.kind ?? 'OUTRO';

  return {
    id: input.id,
    amountCents,
    // Moeda fixa em BRL nesta fase: boleto e PIX so existem em real, e
    // fingir suporte a multimoeda sem ter testado seria pior do que a
    // limitacao declarada.
    currency: 'BRL',
    dueDate,
    payee: doModelo?.payee ?? pix?.merchantName ?? input.fromName ?? input.fromEmail ?? null,
    kind,
    digitableLine: boleto?.digitableLine ?? null,
    pixPayload: pix?.payload ?? null,
    pixKey: pix?.key ?? null,
    confidence,
    source,
    // Sem o modelo nao ha como distinguir cobranca de recibo, entao o padrao
    // e "e cobranca": aparecer a mais e recuperavel, sumir nao e.
    isPayable: doModelo?.isPayable ?? true,
    reason: razoes.length > 0 ? razoes.join('; ') : 'Nada identificado automaticamente',
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Orquestracao
// ---------------------------------------------------------------------------

export interface BillRunResult {
  extractions: BillExtraction[];
  /** Quantas tiveram instrumento de pagamento valido (sem depender do modelo). */
  withInstrument: number;
  /** Itens cujo lote falhou no modelo. Extraidos assim mesmo, sem ele. */
  modelFailures: string[];
}

function chunk<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Extrai um conjunto de cobrancas.
 *
 * Diferenca importante em relacao a triagem: aqui uma falha do modelo NAO
 * degrada o item para "revise manualmente". A camada deterministica ja
 * rodou, entao um boleto continua com valor, vencimento e linha digitavel
 * mesmo sem nenhuma chamada de API ter dado certo.
 *
 * `model` opcional de proposito: sem chave configurada o painel funciona,
 * com menos campos preenchidos e dizendo isso.
 */
export async function runBillExtraction(
  inputs: BillInput[],
  model: BillModel | null,
  hoje = new Date(),
): Promise<BillRunResult> {
  const achadosPorId = new Map<string, DeterministicFindings>();
  for (const input of inputs) achadosPorId.set(input.id, extractDeterministic(input, hoje));

  const doModeloPorId = new Map<string, ExtractionResponse['results'][number]>();
  const modelFailures: string[] = [];

  if (model) {
    const systemPrompt = buildBillSystemPrompt();
    for (const lote of chunk(inputs, BILL_BATCH_SIZE)) {
      try {
        const resposta = await model.extract(systemPrompt, buildBillBatchPrompt(lote));
        for (const r of resposta.results) doModeloPorId.set(r.id, r);
        // Item que o modelo esqueceu tambem conta como falha dele.
        for (const input of lote) {
          if (!doModeloPorId.has(input.id)) modelFailures.push(input.id);
        }
      } catch {
        // Um lote que falhou nao derruba os outros nem apaga a extracao
        // deterministica ja feita.
        for (const input of lote) modelFailures.push(input.id);
      }
    }
  } else {
    modelFailures.push(...inputs.map((i) => i.id));
  }

  const extractions = inputs.map((input) =>
    mergeExtraction(
      input,
      achadosPorId.get(input.id) ?? extractDeterministic(input, hoje),
      doModeloPorId.get(input.id) ?? null,
    ),
  );

  return {
    extractions,
    withInstrument: extractions.filter((e) => e.source === 'INSTRUMENT').length,
    modelFailures,
  };
}
