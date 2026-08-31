/** Tipos da geracao de rascunhos (fase 5D). Ver docs/07-agente-de-triagem.md */

import type { VoiceForDraft } from './compose';

export type DraftStatus = 'PROPOSED' | 'EDITED' | 'APPROVED' | 'DISCARDED';

/**
 * O que a geracao ve.
 *
 * PRIVACIDADE: aqui vai o corpo da mensagem a ser respondida — nao ha como
 * responder sem ler. Continua sendo "corpo sob demanda": um item por vez,
 * quando VOCE pede o rascunho daquele item. Nunca em lote pela caixa.
 */
export interface DraftInput {
  /** Id do UnifiedItem. */
  id: string;
  fromEmail?: string | null;
  fromName?: string | null;
  subject?: string | null;
  /** Corpo da mensagem que sera respondida. */
  body: string;
  receivedAt: Date;
  /** Instrucao sua para este rascunho ("recuse educadamente", "peça prazo"). */
  direction?: string | null;
}

/** Contexto do negocio daquela caixa. Espelha MailboxProfile. */
export interface DraftMailboxContext {
  accountEmail: string;
  businessName?: string | null;
  role?: string | null;
  objective?: string | null;
}

export interface DraftGeneration {
  id: string;
  /** So o miolo: sem saudacao, despedida ou assinatura. */
  bodyGenerated: string;
  /** Texto final montado com o perfil de voz. */
  bodyComposed: string;
  subject: string;
  reason: string;
  error?: string;
}

/**
 * Por que a geracao foi recusada. Recusa e um resultado legitimo desta
 * fase, nao um erro: gerar rascunho com perfil que voce nao validou seria
 * exatamente o que a 5C existiu para impedir.
 */
export type DraftRefusal =
  | 'SEM_PERFIL_DE_VOZ'
  | 'PERFIL_NAO_VALIDADO'
  | 'SEM_CORPO'
  | 'SEM_CHAVE_DE_API';

export interface DraftRefused {
  refusal: DraftRefusal;
  message: string;
}

export type { VoiceForDraft };
