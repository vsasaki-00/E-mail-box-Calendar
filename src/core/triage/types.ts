/**
 * Tipos canonicos da triagem. Ver docs/07-agente-de-triagem.md
 *
 * Espelham os enums do Prisma, mas vivem aqui para que a logica pura
 * (pre-filtro, prompt, avaliacao) seja testavel sem tocar no banco.
 */

export type TriageCategory =
  /** Fornecedor cobrando: boleto, fatura, assinatura, NF. Contas a pagar. */
  | 'COBRANCA'
  /** Alguem esperando resposta. */
  | 'NEEDS_REPLY'
  /** Relevante mas sem acao exigida. */
  | 'INFORMATIVE'
  /** Marketing, newsletter, lista. */
  | 'PROMOTIONAL'
  | 'SPAM'
  /** Sem valor, candidato a arquivar. Nunca excluido automaticamente. */
  | 'DISPOSABLE';

export type TriagePriority = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';

export type TriageSource = 'RULE' | 'MODEL' | 'USER';

export type TriageCalibration = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

/**
 * O que a triagem ve de um e-mail.
 *
 * Deliberadamente SEM o corpo da mensagem: a triagem em massa nunca envia
 * conteudo de e-mail para a API. Ver a decisao de privacidade em
 * docs/07-agente-de-triagem.md — 80% da decisao esta no remetente e no
 * assunto, e o restante nao justifica exportar o corpo de tudo.
 */
export interface TriageInput {
  /** Id do UnifiedItem, para casar o resultado de volta. */
  id: string;
  fromEmail?: string | null;
  fromName?: string | null;
  subject?: string | null;
  /** Trecho curto ja fornecido pelo provedor. Nunca o corpo completo. */
  snippet?: string | null;
  receivedAt: Date;
  hasAttachments: boolean;
  /** Cabecalhos que denunciam lista de distribuicao, quando disponiveis. */
  headers?: {
    listUnsubscribe?: string | null;
    listId?: string | null;
    precedence?: string | null;
    autoSubmitted?: string | null;
  };
  /** O usuario esta no To: (destinatario direto) ou so no Cc:? */
  isDirectRecipient: boolean;
  /** Quantos destinatarios ha no total. Muitos = provavelmente difusao. */
  recipientCount: number;
}

export interface TriageResult {
  id: string;
  category: TriageCategory;
  priority: TriagePriority;
  needsReply: boolean;
  /** 0..1 */
  confidence: number;
  reason: string;
  source: TriageSource;
}

/** Contexto da caixa que altera a decisao. Ver MailboxProfile no schema. */
export interface MailboxContext {
  businessName?: string | null;
  role?: string | null;
  objective?: string | null;
  calibration: TriageCalibration;
  /** Remetentes/dominios nunca rebaixados. */
  vipSenders: string[];
  /** Palavras que elevam prioridade nesta caixa especificamente. */
  urgentKeywords: string[];
  /** Endereco da propria conta, para detectar auto-envio e mencao direta. */
  accountEmail: string;
}

export const DEFAULT_MAILBOX_CONTEXT: Omit<MailboxContext, 'accountEmail'> = {
  calibration: 'BALANCED',
  vipSenders: [],
  urgentKeywords: [],
};
