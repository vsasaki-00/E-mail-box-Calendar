import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { composeDraft, type VoiceForDraft } from './compose';
import { buildDraftSystemPrompt, buildDraftUserPrompt, DRAFT_PROMPT_VERSION } from './prompt';
import type { DraftGeneration, DraftInput, DraftMailboxContext, DraftRefused } from './types';

/**
 * Geracao de rascunhos (fase 5D). Ver docs/07-agente-de-triagem.md
 *
 * A REGRA DESTA FASE, e ela nao tem exceção: **nada aqui envia e-mail**.
 * Não há caminho de código para envio. Não é um envio desligado por flag —
 * é a ausência da capacidade. O rascunho existe para você copiar, editar e
 * mandar você mesmo.
 *
 * A segunda regra: só gera com perfil de voz que VOCÊ validou. Gerar com
 * perfil não validado desmontaria a fase 5C inteira.
 */

const DraftSchema = z.object({
  /** So o miolo: sem saudacao, despedida ou assinatura. */
  body: z.string(),
  /** Assunto sugerido. */
  subject: z.string(),
  /** Por que respondeu assim, em uma frase. */
  reason: z.string(),
});

export type DraftResponse = z.infer<typeof DraftSchema>;

/** A costura que permite testar sem API. */
export interface DraftModel {
  readonly name: string;
  draft(systemPrompt: string, userPrompt: string): Promise<DraftResponse>;
}

export const DEFAULT_DRAFT_MODEL = 'claude-opus-5';

export function createAnthropicDraftModel(options?: { apiKey?: string; model?: string }): DraftModel {
  const model = options?.model ?? process.env.DRAFT_MODEL ?? DEFAULT_DRAFT_MODEL;
  const client = new Anthropic(options?.apiKey ? { apiKey: options.apiKey } : {});

  return {
    name: model,
    async draft(systemPrompt, userPrompt) {
      const response = await client.messages.parse({
        model,
        max_tokens: 4000,
        // Escrever no lugar de alguem e a tarefa mais dificil do sistema, e
        // sao poucas por dia — aqui o esforco alto se paga, ao contrario da
        // triagem em massa.
        output_config: { effort: 'medium', format: zodOutputFormat(DraftSchema) },
        system: [
          {
            type: 'text',
            text: systemPrompt,
            // O prompt de sistema e o mesmo para toda a caixa.
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

export interface VoiceProfileGate {
  voz: VoiceForDraft;
  userApproved: boolean;
  derivedAt: Date;
}

/**
 * Decide se pode gerar. Recusa e resultado legitimo, nao erro.
 *
 * Separado da geracao de proposito: e a regra mais importante da fase, e
 * ela precisa ser testavel sem tocar em modelo nenhum.
 */
export function checkDraftPreconditions(
  input: DraftInput,
  perfil: VoiceProfileGate | null,
  temChave: boolean,
): DraftRefused | null {
  if (!perfil) {
    return {
      refusal: 'SEM_PERFIL_DE_VOZ',
      message:
        'Esta caixa ainda não tem perfil de voz. Sem ele o rascunho não soaria como ' +
        'você — derive o perfil em /voz primeiro.',
    };
  }

  if (!perfil.userApproved) {
    return {
      refusal: 'PERFIL_NAO_VALIDADO',
      message:
        'O perfil de voz desta caixa existe mas você ainda não confirmou que é assim ' +
        'que escreve. Valide em /voz antes de gerar rascunhos.',
    };
  }

  if (!input.body.trim()) {
    return {
      refusal: 'SEM_CORPO',
      message:
        'A mensagem original não tem corpo carregado. Sincronize a conta ou abra o ' +
        'e-mail para carregar o conteúdo antes de pedir um rascunho.',
    };
  }

  if (!temChave) {
    return {
      refusal: 'SEM_CHAVE_DE_API',
      message:
        'Rascunho precisa do modelo, e não há ANTHROPIC_API_KEY configurada. ' +
        'Diferente do painel financeiro, aqui não há camada local que substitua.',
    };
  }

  return null;
}

function assuntoDeResposta(original: string | null | undefined, sugerido: string): string {
  const base = original?.trim();
  if (!base) return sugerido.trim() || '(sem assunto)';
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/**
 * Gera um rascunho. Um item por vez, porque e assim que voce pede.
 *
 * Nunca lanca: uma falha de API vira `error` no resultado, e a UI diz o que
 * aconteceu em vez de quebrar.
 */
export async function generateDraft(
  input: DraftInput,
  contexto: DraftMailboxContext,
  perfil: VoiceProfileGate,
  model: DraftModel,
): Promise<DraftGeneration> {
  const base = { id: input.id };

  try {
    const resposta = await model.draft(
      buildDraftSystemPrompt(contexto, perfil.voz),
      buildDraftUserPrompt(input),
    );

    // A composicao local e quem garante que a assinatura sai exata e que a
    // saudacao/despedida nao aparecem em dobro.
    const composto = composeDraft(resposta.body, perfil.voz, {
      fromName: input.fromName,
      fromEmail: input.fromEmail,
    });

    return {
      ...base,
      bodyGenerated: resposta.body,
      bodyComposed: composto.text,
      subject: assuntoDeResposta(input.subject, resposta.subject),
      reason: resposta.reason,
    };
  } catch (erro) {
    return {
      ...base,
      bodyGenerated: '',
      bodyComposed: '',
      subject: assuntoDeResposta(input.subject, ''),
      reason: '',
      error: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

export { DRAFT_PROMPT_VERSION };
