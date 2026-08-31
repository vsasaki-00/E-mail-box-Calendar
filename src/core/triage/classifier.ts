import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { prefilter } from './prefilter';
import { buildBatchPrompt, buildSystemPrompt, PROMPT_VERSION } from './prompt';
import type { MailboxContext, TriageInput, TriageResult } from './types';
import { envOu } from '@/lib/env';

/**
 * Classificador de triagem. Ver docs/07-agente-de-triagem.md
 *
 * Estrutura em duas camadas:
 *  1. pre-filtro deterministico decide o que da para decidir com certeza;
 *  2. o modelo ve apenas o que sobrou — e apenas METADADOS, nunca o corpo.
 *
 * A chamada ao modelo fica atras da interface `TriageModel`, o que permite
 * testar toda a orquestracao (lote, fallback, itens ausentes na resposta)
 * sem rede e sem credencial.
 */

const CATEGORIES = [
  'COBRANCA',
  'NEEDS_REPLY',
  'INFORMATIVE',
  'PROMOTIONAL',
  'SPAM',
  'DISPOSABLE',
] as const;

const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const;

const ClassificationSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      category: z.enum(CATEGORIES),
      priority: z.enum(PRIORITIES),
      needsReply: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

export type ClassificationResponse = z.infer<typeof ClassificationSchema>;

/** A costura que permite testar sem API. */
export interface TriageModel {
  readonly name: string;
  classify(systemPrompt: string, userPrompt: string): Promise<ClassificationResponse>;
}

/** Quantas mensagens por chamada. Lotes grandes diluem a atencao do modelo. */
export const BATCH_SIZE = 25;

/**
 * O modelo padrao. `claude-opus-5` e a escolha default do projeto; trocar
 * por um modelo mais barato e uma decisao do usuario, nao do codigo — a
 * conta em docs/07-agente-de-triagem.md mostra que a triagem inteira custa
 * dezenas de dolares por mes, entao economizar aqui rende pouco e custa
 * acerto.
 */
export const DEFAULT_TRIAGE_MODEL = 'claude-opus-5';

export function createAnthropicTriageModel(options?: {
  apiKey?: string;
  model?: string;
}): TriageModel {
  const model = options?.model ?? envOu(process.env.TRIAGE_MODEL, DEFAULT_TRIAGE_MODEL);
  const client = new Anthropic(options?.apiKey ? { apiKey: options.apiKey } : {});

  return {
    name: model,
    async classify(systemPrompt, userPrompt) {
      const response = await client.messages.parse({
        model,
        max_tokens: 16000,
        // Triagem e trabalho de rotina em alto volume: `low` e onde a
        // relacao qualidade/custo fica melhor para classificacao.
        output_config: { effort: 'low', format: zodOutputFormat(ClassificationSchema) },
        system: [
          {
            type: 'text',
            text: systemPrompt,
            // O prompt de sistema e identico para todos os lotes da mesma
            // caixa: cachear derruba o custo de entrada em ~90%.
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

export interface TriageRunResult {
  results: TriageResult[];
  /** Quantos foram resolvidos sem chamar o modelo. */
  decidedByRule: number;
  /** Quantos exigiram o modelo. */
  decidedByModel: number;
  /** Itens que o modelo deixou de devolver — tratados, nao perdidos. */
  missing: string[];
}

function fallbackResult(input: TriageInput, motivo: string): TriageResult {
  // Um item que o modelo nao classificou NAO pode sumir da caixa. Ele volta
  // como "precisa de olhar humano", com confianca zero: a UI mostra, e o
  // usuario decide. Silenciar aqui seria o pior modo de falha possivel.
  return {
    id: input.id,
    category: 'NEEDS_REPLY',
    priority: 'NORMAL',
    needsReply: false,
    confidence: 0,
    reason: `Não classificado automaticamente (${motivo}) — revise manualmente`,
    source: 'MODEL',
  };
}

function chunk<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Classifica um conjunto de mensagens de UMA caixa (o contexto e por caixa).
 *
 * Nunca lanca por causa de um lote: uma falha de API num lote nao pode
 * derrubar a triagem inteira — os itens daquele lote voltam com confianca
 * zero para revisao manual, e o resto segue.
 */
export async function runTriage(
  inputs: TriageInput[],
  context: MailboxContext,
  model: TriageModel,
): Promise<TriageRunResult> {
  const results: TriageResult[] = [];
  const paraOModelo: TriageInput[] = [];

  for (const input of inputs) {
    const decisao = prefilter(input, context);
    if (decisao) results.push(decisao);
    else paraOModelo.push(input);
  }

  const decidedByRule = results.length;
  const missing: string[] = [];

  if (paraOModelo.length > 0) {
    const systemPrompt = buildSystemPrompt(context);

    for (const lote of chunk(paraOModelo, BATCH_SIZE)) {
      let resposta: ClassificationResponse | null = null;
      try {
        resposta = await model.classify(systemPrompt, buildBatchPrompt(lote));
      } catch (erro) {
        const motivo = erro instanceof Error ? erro.message : String(erro);
        for (const input of lote) {
          results.push(fallbackResult(input, motivo));
          missing.push(input.id);
        }
        continue;
      }

      const porId = new Map(resposta.results.map((r) => [r.id, r]));
      for (const input of lote) {
        const encontrado = porId.get(input.id);
        if (!encontrado) {
          results.push(fallbackResult(input, 'ausente na resposta do modelo'));
          missing.push(input.id);
          continue;
        }
        results.push({
          id: input.id,
          category: encontrado.category,
          priority: encontrado.priority,
          needsReply: encontrado.needsReply,
          confidence: encontrado.confidence,
          reason: encontrado.reason,
          source: 'MODEL',
        });
      }
    }
  }

  return {
    results,
    decidedByRule,
    decidedByModel: results.length - decidedByRule - missing.length,
    missing,
  };
}

export { PROMPT_VERSION };
