import type { TriageCategory, TriagePriority, TriageResult } from './types';

/**
 * Avaliacao da triagem contra o comportamento historico do usuario.
 *
 * Ver docs/07-agente-de-triagem.md — sem isso, confiar na triagem seria uma
 * aposta. Com isso, da para dizer "concorda com voce em 91% dos casos, e
 * aqui estao os 9% em que discorda".
 *
 * O gabarito nao e rotulado a mao: ele e DERIVADO do que o usuario ja fez.
 */

/**
 * O que o usuario fez com a mensagem, observado no historico sincronizado.
 * Cada sinal e fraco sozinho; juntos formam um rotulo utilizavel.
 */
export interface ObservedBehavior {
  id: string;
  /** O usuario respondeu? Sinal mais forte de "precisava resposta". */
  wasRepliedTo: boolean;
  /** Horas ate a resposta, quando houve. Resposta rapida = era urgente. */
  hoursToReply?: number | null;
  /** Chegou a ser aberta? Arquivar sem abrir e sinal forte de descartavel. */
  wasRead: boolean;
  /** Saiu da caixa de entrada (arquivada ou apagada). */
  wasArchivedOrDeleted: boolean;
  /** Estava na pasta de spam do provedor. Gabarito direto para SPAM. */
  wasInSpamFolder: boolean;
}

/** Rotulo derivado do comportamento. `null` = comportamento ambiguo. */
export interface GroundTruthLabel {
  id: string;
  needsReply: boolean | null;
  category: TriageCategory | null;
  priority: TriagePriority | null;
}

/** Abaixo disso consideramos que o usuario tratou como urgente. */
export const URGENT_REPLY_HOURS = 4;
/** Resposta dentro deste prazo ainda indica prioridade alta. */
export const HIGH_PRIORITY_REPLY_HOURS = 24;

/**
 * Traduz comportamento em rotulo.
 *
 * Deliberadamente conservador: quando o sinal e ambiguo, devolve `null` em
 * vez de chutar. Um gabarito ruim e pior que gabarito nenhum — ele daria
 * uma metrica bonita e falsa.
 */
export function deriveLabel(behavior: ObservedBehavior): GroundTruthLabel {
  const label: GroundTruthLabel = {
    id: behavior.id,
    needsReply: null,
    category: null,
    priority: null,
  };

  // Spam do provedor e gabarito direto e confiavel.
  if (behavior.wasInSpamFolder) {
    return { id: behavior.id, needsReply: false, category: 'SPAM', priority: 'LOW' };
  }

  if (behavior.wasRepliedTo) {
    // Respondeu: precisava de resposta. Sinal mais forte que existe.
    label.needsReply = true;
    label.category = 'NEEDS_REPLY';

    const horas = behavior.hoursToReply;
    if (typeof horas === 'number') {
      if (horas <= URGENT_REPLY_HOURS) label.priority = 'URGENT';
      else if (horas <= HIGH_PRIORITY_REPLY_HOURS) label.priority = 'HIGH';
      else label.priority = 'NORMAL';
    }
    return label;
  }

  // Arquivou/apagou sem nunca abrir: descartavel com alta confianca.
  if (behavior.wasArchivedOrDeleted && !behavior.wasRead) {
    return { id: behavior.id, needsReply: false, category: 'DISPOSABLE', priority: 'LOW' };
  }

  // Leu e arquivou sem responder: nao precisava de resposta. Mas nao da
  // para saber se era informativo, promocional ou cobranca ja paga — entao
  // so afirmamos o que o comportamento sustenta.
  if (behavior.wasRead && behavior.wasArchivedOrDeleted) {
    label.needsReply = false;
    return label;
  }

  // Ainda na caixa, sem resposta: pode ser pendencia real ou item ignorado.
  // Ambiguo de proposito.
  return label;
}

export interface AgreementMetric {
  /** Casos em que havia gabarito para comparar. */
  evaluated: number;
  agreed: number;
  /** 0..1. `null` quando nao houve caso avaliavel. */
  accuracy: number | null;
}

export interface EvaluationReport {
  needsReply: AgreementMetric & {
    /** Disse que precisa resposta e nao precisava. Custa ruido. */
    falsePositives: string[];
    /** Disse que nao precisa e precisava. Custa uma resposta perdida. */
    falseNegatives: string[];
  };
  category: AgreementMetric & { disagreements: { id: string; predicted: TriageCategory; actual: TriageCategory }[] };
  priority: AgreementMetric;
  /** Itens escondidos (SPAM/DISPOSABLE) que o usuario de fato respondeu. */
  dangerousMisses: string[];
}

function metric(evaluated: number, agreed: number): AgreementMetric {
  return { evaluated, agreed, accuracy: evaluated === 0 ? null : agreed / evaluated };
}

/**
 * Compara predicoes com o gabarito derivado.
 *
 * `dangerousMisses` merece destaque proprio: e a metrica que importa mais e
 * que uma acuracia global esconderia. Um sistema com 95% de acerto que
 * esconde tres e-mails de cliente e pior que um com 85% que nunca esconde.
 */
export function evaluateTriage(
  predictions: TriageResult[],
  labels: GroundTruthLabel[],
): EvaluationReport {
  const porId = new Map(labels.map((l) => [l.id, l]));

  let needsReplyEval = 0;
  let needsReplyAgreed = 0;
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];

  let categoryEval = 0;
  let categoryAgreed = 0;
  const disagreements: { id: string; predicted: TriageCategory; actual: TriageCategory }[] = [];

  let priorityEval = 0;
  let priorityAgreed = 0;

  const dangerousMisses: string[] = [];

  for (const predicao of predictions) {
    const gabarito = porId.get(predicao.id);
    if (!gabarito) continue;

    if (gabarito.needsReply !== null) {
      needsReplyEval += 1;
      if (predicao.needsReply === gabarito.needsReply) needsReplyAgreed += 1;
      else if (predicao.needsReply) falsePositives.push(predicao.id);
      else falseNegatives.push(predicao.id);
    }

    if (gabarito.category !== null) {
      categoryEval += 1;
      if (predicao.category === gabarito.category) categoryAgreed += 1;
      else disagreements.push({ id: predicao.id, predicted: predicao.category, actual: gabarito.category });

      // O erro assimetrico: escondemos algo que o usuario respondeu.
      const escondido = predicao.category === 'SPAM' || predicao.category === 'DISPOSABLE';
      if (escondido && gabarito.category === 'NEEDS_REPLY') dangerousMisses.push(predicao.id);
    }

    if (gabarito.priority !== null) {
      priorityEval += 1;
      if (predicao.priority === gabarito.priority) priorityAgreed += 1;
    }
  }

  return {
    needsReply: { ...metric(needsReplyEval, needsReplyAgreed), falsePositives, falseNegatives },
    category: { ...metric(categoryEval, categoryAgreed), disagreements },
    priority: metric(priorityEval, priorityAgreed),
    dangerousMisses,
  };
}

/**
 * O criterio de aceite da fase 5A, em codigo.
 *
 * Duas barreiras, e a segunda nao negocia: acuracia razoavel em "precisa
 * resposta", e ZERO itens escondidos que o usuario de fato respondeu.
 */
export const MIN_NEEDS_REPLY_ACCURACY = 0.85;

export function meetsAcceptanceCriteria(report: EvaluationReport): {
  passed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  const acuracia = report.needsReply.accuracy;
  if (acuracia === null) {
    reasons.push('Nenhum caso avaliável: histórico insuficiente para medir');
  } else if (acuracia < MIN_NEEDS_REPLY_ACCURACY) {
    reasons.push(
      `Acurácia em "precisa resposta" de ${(acuracia * 100).toFixed(1)}% está abaixo do mínimo de ${(MIN_NEEDS_REPLY_ACCURACY * 100).toFixed(0)}%`,
    );
  }

  if (report.dangerousMisses.length > 0) {
    reasons.push(
      `${report.dangerousMisses.length} mensagem(ns) que você respondeu foram classificadas como spam ou descartável — isso não pode acontecer`,
    );
  }

  return { passed: reasons.length === 0, reasons };
}
