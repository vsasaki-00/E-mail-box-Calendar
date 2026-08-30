import type { MailboxContext, TriageInput, TriageResult } from './types';

/**
 * Pre-filtro deterministico: decide sem gastar uma chamada de API.
 *
 * Ver docs/07-agente-de-triagem.md — o objetivo NAO e economizar dinheiro
 * (a triagem inteira custa dezenas de dolares por mes). E:
 *  - nao gastar uma chamada numa decisao que uma regra resolve com certeza;
 *  - dar resposta instantanea nesses casos;
 *  - garantir que remetente VIP nunca dependa do julgamento de um modelo.
 *
 * Funcao pura: sem rede, sem banco. Devolve `null` quando nao tem certeza —
 * e ai o modelo decide.
 */

/** Confianca atribuida a uma decisao deterministica. Alta por construcao. */
const RULE_CONFIDENCE = 0.95;

function normalizarEmail(valor?: string | null): string {
  if (!valor) return '';
  const comColchetes = valor.match(/<([^>]+)>/);
  return (comColchetes?.[1] ?? valor).trim().toLowerCase();
}

function dominioDe(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1);
}

/**
 * Um remetente casa com a lista VIP se o endereco bate exatamente, ou se o
 * dominio bate quando a entrada da lista e um dominio (sem "@").
 */
export function isVipSender(fromEmail: string | null | undefined, vipSenders: string[]): boolean {
  const email = normalizarEmail(fromEmail);
  if (!email) return false;
  const dominio = dominioDe(email);

  return vipSenders.some((entrada) => {
    const alvo = entrada.trim().toLowerCase().replace(/^@/, '');
    if (!alvo) return false;
    return alvo.includes('@') ? email === alvo : dominio === alvo;
  });
}

/**
 * Cabecalhos que denunciam envio em massa. `List-Unsubscribe` e o sinal mais
 * forte e mais honesto: quem manda newsletter legitima o inclui.
 */
export function isBulkMail(input: TriageInput): boolean {
  const h = input.headers;
  if (!h) return false;
  if (h.listUnsubscribe || h.listId) return true;
  const precedence = h.precedence?.trim().toLowerCase();
  if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') return true;
  return false;
}

/**
 * Resposta automatica (ferias, "recebemos seu chamado"). Nunca precisa de
 * resposta e nunca e urgente.
 */
export function isAutoSubmitted(input: TriageInput): boolean {
  const valor = input.headers?.autoSubmitted?.trim().toLowerCase();
  return Boolean(valor && valor !== 'no');
}

/** Remetentes que, por construcao, nao leem respostas. */
const PREFIXOS_NO_REPLY = ['noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'nao-responda', 'naoresponda'];

export function isNoReplyAddress(fromEmail?: string | null): boolean {
  const email = normalizarEmail(fromEmail);
  if (!email) return false;
  const usuario = email.split('@')[0] ?? '';
  return PREFIXOS_NO_REPLY.some((prefixo) => usuario.startsWith(prefixo));
}

/**
 * Decide o que der para decidir com certeza. `null` = passa para o modelo.
 *
 * A ordem importa: VIP vem primeiro e vence tudo. Um cliente importante que
 * por acaso manda de uma ferramenta com List-Unsubscribe nao pode ser
 * rebaixado a promocional.
 */
export function prefilter(input: TriageInput, context: MailboxContext): TriageResult | null {
  const base = { id: input.id, source: 'RULE' as const, confidence: RULE_CONFIDENCE };

  // 1. VIP vence qualquer outra regra. Nunca rebaixado, nunca escondido.
  if (isVipSender(input.fromEmail, context.vipSenders)) {
    return {
      ...base,
      category: 'NEEDS_REPLY',
      priority: 'HIGH',
      needsReply: true,
      reason: 'Remetente na lista VIP desta caixa',
    };
  }

  // 2. Auto-resposta: informativo por definicao, nunca exige acao.
  if (isAutoSubmitted(input)) {
    return {
      ...base,
      category: 'INFORMATIVE',
      priority: 'LOW',
      needsReply: false,
      reason: 'Resposta automatica (cabecalho Auto-Submitted)',
    };
  }

  // 3. E-mail em massa. Deliberadamente NAO classificamos como SPAM: uma
  //    newsletter legitima que o usuario assinou nao e spam, e marcar como
  //    tal treina o usuario a desconfiar da triagem. Promocional e o rotulo
  //    honesto; o modelo ainda pode elevar se o assunto indicar cobranca.
  if (isBulkMail(input)) {
    // Excecao: cobranca de assinatura costuma vir por ferramenta de
    //    disparo e carrega List-Unsubscribe. Deixamos o modelo olhar.
    if (!pareceCobranca(input)) {
      return {
        ...base,
        category: 'PROMOTIONAL',
        priority: 'LOW',
        needsReply: false,
        reason: 'Envio em massa (List-Unsubscribe/List-Id)',
      };
    }
  }

  // 4. Endereco que nao le resposta: seja o que for, nao ha o que responder.
  //    Ainda pode ser cobranca — por isso so decidimos quando NAO parece.
  if (isNoReplyAddress(input.fromEmail) && !pareceCobranca(input)) {
    return {
      ...base,
      category: 'INFORMATIVE',
      priority: 'LOW',
      needsReply: false,
      reason: 'Remetente no-reply, sem indicio de cobranca',
    };
  }

  // Sem certeza: o modelo decide.
  return null;
}

/**
 * Heuristica leve de cobranca, usada apenas para EVITAR que uma regra
 * deterministica descarte algo que pode ser uma fatura. Nao classifica
 * sozinha como COBRANCA — isso fica com o modelo, que erra menos em
 * portugues real ("seu pedido foi faturado" nao e cobranca).
 */
export function pareceCobranca(input: TriageInput): boolean {
  const texto = `${input.subject ?? ''} ${input.snippet ?? ''}`.toLowerCase();
  const termos = [
    'boleto',
    'fatura',
    'cobran',
    'vencimento',
    'vence em',
    'nota fiscal',
    'nfe',
    'nf-e',
    'pagamento',
    'invoice',
    'pagar',
    'segunda via',
    'codigo de barras',
    'código de barras',
    'linha digitavel',
    'linha digitável',
    'pix',
    'mensalidade',
    'assinatura renovada',
    'renovacao automatica',
    'renovação automática',
  ];
  return termos.some((termo) => texto.includes(termo));
}
