/**
 * Politica das acoes de escrita. Ver docs/08-escrita-e-acoes.md
 *
 * Funcoes puras: dado o tipo de acao, o que ela faz, se da para desfazer, e
 * quanto cuidado exige antes de executar.
 *
 * Isolado do banco e do provedor de proposito. Esta e a camada que decide
 * o que o app tem permissao de fazer na sua caixa, e ela precisa ser
 * legivel e testavel sem nada em volta.
 */

export type ActionKind =
  | 'ARCHIVE'
  | 'UNARCHIVE'
  | 'MARK_READ'
  | 'MARK_UNREAD'
  | 'ADD_LABEL'
  | 'REMOVE_LABEL'
  | 'EVENT_ACCEPT'
  | 'EVENT_DECLINE'
  | 'EVENT_TENTATIVE'
  | 'EVENT_CREATE'
  | 'EVENT_MOVE'
  | 'SEND_REPLY';

export type ActionStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'DONE'
  | 'FAILED'
  | 'UNDONE'
  | 'CANCELLED';

export type ActionActor = 'USER' | 'AGENT';

/**
 * Quanto cuidado a acao exige.
 *
 * `IRREVERSIBLE` nao e so um rotulo: e o que faz a UI pedir uma confirmacao
 * separada e o que impede a acao de entrar em lote.
 */
export type ActionRisk = 'REVERSIBLE' | 'IRREVERSIBLE';

export interface ActionSpec {
  kind: ActionKind;
  risk: ActionRisk;
  /** A acao que desfaz esta. `null` quando nao ha volta. */
  inverse: ActionKind | null;
  /** Pode ser aplicada a varios itens de uma vez? */
  allowBulk: boolean;
  /** Alvo: mensagem ou evento. */
  target: 'MESSAGE' | 'EVENT';
}

/**
 * O catalogo fechado do que o app sabe fazer.
 *
 * Repare no que NAO esta aqui: nenhuma acao de excluir. Arquivar resolve o
 * mesmo problema e volta atras; apagar e o unico erro que voce nunca
 * descobre, porque a evidencia do erro vai junto.
 */
export const ACTION_SPECS: Record<ActionKind, ActionSpec> = {
  ARCHIVE: { kind: 'ARCHIVE', risk: 'REVERSIBLE', inverse: 'UNARCHIVE', allowBulk: true, target: 'MESSAGE' },
  UNARCHIVE: { kind: 'UNARCHIVE', risk: 'REVERSIBLE', inverse: 'ARCHIVE', allowBulk: true, target: 'MESSAGE' },
  MARK_READ: { kind: 'MARK_READ', risk: 'REVERSIBLE', inverse: 'MARK_UNREAD', allowBulk: true, target: 'MESSAGE' },
  MARK_UNREAD: { kind: 'MARK_UNREAD', risk: 'REVERSIBLE', inverse: 'MARK_READ', allowBulk: true, target: 'MESSAGE' },
  ADD_LABEL: { kind: 'ADD_LABEL', risk: 'REVERSIBLE', inverse: 'REMOVE_LABEL', allowBulk: true, target: 'MESSAGE' },
  REMOVE_LABEL: { kind: 'REMOVE_LABEL', risk: 'REVERSIBLE', inverse: 'ADD_LABEL', allowBulk: true, target: 'MESSAGE' },

  // Responder a convite: a resposta anterior fica em `previousState`, entao
  // da para voltar ao que estava.
  EVENT_ACCEPT: { kind: 'EVENT_ACCEPT', risk: 'REVERSIBLE', inverse: 'EVENT_DECLINE', allowBulk: false, target: 'EVENT' },
  EVENT_DECLINE: { kind: 'EVENT_DECLINE', risk: 'REVERSIBLE', inverse: 'EVENT_ACCEPT', allowBulk: false, target: 'EVENT' },
  EVENT_TENTATIVE: { kind: 'EVENT_TENTATIVE', risk: 'REVERSIBLE', inverse: null, allowBulk: false, target: 'EVENT' },

  // Criar evento avisa os convidados. Voltar atras cancela um convite que
  // ja chegou na caixa dos outros — o e-mail de cancelamento nao se desfaz.
  EVENT_CREATE: { kind: 'EVENT_CREATE', risk: 'IRREVERSIBLE', inverse: null, allowBulk: false, target: 'EVENT' },
  EVENT_MOVE: { kind: 'EVENT_MOVE', risk: 'REVERSIBLE', inverse: 'EVENT_MOVE', allowBulk: false, target: 'EVENT' },

  // A unica acao que sai da sua caixa para a de outra pessoa.
  SEND_REPLY: { kind: 'SEND_REPLY', risk: 'IRREVERSIBLE', inverse: null, allowBulk: false, target: 'MESSAGE' },
};

export function specFor(kind: ActionKind): ActionSpec {
  return ACTION_SPECS[kind];
}

export function isReversible(kind: ActionKind): boolean {
  return ACTION_SPECS[kind].risk === 'REVERSIBLE';
}

/**
 * Uma acao IRREVERSIVEL nunca pode ser pedida pelo agente sozinho.
 *
 * Esta e a regra que separa "o app trabalha para mim" de "o app fala por
 * mim sem eu ver". Enviar e criar evento sao coisas que outras pessoas
 * recebem; elas exigem um humano no meio, sempre.
 */
export function canBeRequestedByAgent(kind: ActionKind): boolean {
  return ACTION_SPECS[kind].risk === 'REVERSIBLE';
}

/** Acao irreversivel nunca entra em lote, mesmo se alguem tentar. */
export function canBulk(kind: ActionKind): boolean {
  return ACTION_SPECS[kind].allowBulk && isReversible(kind);
}

export interface DescribeParams {
  labelName?: string;
  subject?: string;
  to?: string;
  newStart?: string;
}

/**
 * Uma frase em portugues do que a acao vai fazer.
 *
 * Gravada junto com a acao, e nao derivada na hora de mostrar: se a regra
 * mudar, o log de auditoria precisa continuar dizendo o que foi feito
 * NAQUELE dia, e nao o que a versao de hoje faria.
 */
export function describeAction(kind: ActionKind, params: DescribeParams = {}): string {
  const assunto = params.subject ? `“${params.subject}”` : 'este item';

  switch (kind) {
    case 'ARCHIVE':
      return `Arquivar ${assunto} (sai da entrada, não é apagado)`;
    case 'UNARCHIVE':
      return `Devolver ${assunto} para a caixa de entrada`;
    case 'MARK_READ':
      return `Marcar ${assunto} como lido`;
    case 'MARK_UNREAD':
      return `Marcar ${assunto} como não lido`;
    case 'ADD_LABEL':
      return `Aplicar o marcador “${params.labelName ?? '?'}” em ${assunto}`;
    case 'REMOVE_LABEL':
      return `Remover o marcador “${params.labelName ?? '?'}” de ${assunto}`;
    case 'EVENT_ACCEPT':
      return `Aceitar o convite ${assunto}`;
    case 'EVENT_DECLINE':
      return `Recusar o convite ${assunto}`;
    case 'EVENT_TENTATIVE':
      return `Responder “talvez” ao convite ${assunto}`;
    case 'EVENT_CREATE':
      return `Criar o evento ${assunto} — os convidados serão avisados`;
    case 'EVENT_MOVE':
      return `Mover ${assunto} para ${params.newStart ?? 'outro horário'} — os convidados serão avisados`;
    case 'SEND_REPLY':
      return `ENVIAR resposta para ${params.to ?? 'o remetente'} — ${assunto}. Não tem volta.`;
  }
}

export type ActionRefusal =
  | 'ESCRITA_NAO_AUTORIZADA'
  | 'CONECTOR_NAO_SUPORTA'
  | 'IRREVERSIVEL_SEM_CONFIRMACAO'
  | 'AGENTE_NAO_PODE_PEDIR'
  | 'RASCUNHO_NAO_APROVADO';

export interface PolicyCheck {
  allowed: boolean;
  refusal?: ActionRefusal;
  message?: string;
}

/**
 * A porta por onde toda acao passa antes de executar.
 *
 * Cinco recusas, e cada uma existe por um motivo diferente:
 *  - a caixa nao autorizou escrita (voce nao consentiu);
 *  - o conector nao sabe escrever (nao foi validado);
 *  - acao irreversivel sem confirmacao explicita;
 *  - agente pedindo algo que so humano pode pedir;
 *  - envio de rascunho que voce ainda nao aprovou.
 */
export function checkActionPolicy(params: {
  kind: ActionKind;
  connectionWriteEnabled: boolean;
  connectorCanWrite: boolean;
  actor: ActionActor;
  /**
   * `REQUEST` so enfileira; `EXECUTE` mexe na caixa.
   *
   * A distincao importa: enfileirar uma acao irreversivel e legitimo — e o
   * proposito da fila. Exigir confirmacao ja no pedido impediria a acao de
   * chegar na tela onde voce a confirmaria.
   */
  stage: 'REQUEST' | 'EXECUTE';
  explicitlyConfirmed?: boolean;
  draftApproved?: boolean;
}): PolicyCheck {
  if (!params.connectionWriteEnabled) {
    return {
      allowed: false,
      refusal: 'ESCRITA_NAO_AUTORIZADA',
      message:
        'Esta caixa está em modo somente-leitura. Autorize a escrita nela em /conexoes — ' +
        'é um consentimento novo, por caixa, e o provedor vai pedir sua permissão de novo.',
    };
  }

  if (!params.connectorCanWrite) {
    return {
      allowed: false,
      refusal: 'CONECTOR_NAO_SUPORTA',
      message: 'O conector desta caixa não sabe escrever.',
    };
  }

  if (params.actor === 'AGENT' && !canBeRequestedByAgent(params.kind)) {
    return {
      allowed: false,
      refusal: 'AGENTE_NAO_PODE_PEDIR',
      message:
        'Esta ação sai da sua caixa para a de outra pessoa. O agente pode propor, ' +
        'mas quem pede é você.',
    };
  }

  if (params.stage === 'EXECUTE' && !isReversible(params.kind) && !params.explicitlyConfirmed) {
    return {
      allowed: false,
      refusal: 'IRREVERSIVEL_SEM_CONFIRMACAO',
      message: 'Ação sem volta: precisa da sua confirmação explícita.',
    };
  }

  if (params.stage === 'EXECUTE' && params.kind === 'SEND_REPLY' && params.draftApproved === false) {
    return {
      allowed: false,
      refusal: 'RASCUNHO_NAO_APROVADO',
      message:
        'Este rascunho ainda não foi aprovado por você. Leia e aprove em /rascunhos ' +
        'antes de enviar.',
    };
  }

  return { allowed: true };
}
