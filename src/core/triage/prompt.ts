import type { MailboxContext, TriageInput } from './types';

/**
 * Montagem do prompt de triagem. Funcao pura e testavel — o prompt e a
 * parte mais facil de quebrar sem perceber, entao ele e construido aqui e
 * verificado por teste, nao interpolado no meio da chamada de API.
 *
 * REGRA DE PRIVACIDADE, verificada em teste: nada alem de remetente,
 * assunto e trecho curto entra no prompt. O corpo do e-mail nunca. Ver
 * docs/07-agente-de-triagem.md.
 */

/** Muda quando o prompt muda de forma que invalide classificacoes antigas. */
export const PROMPT_VERSION = 'triage-v1';

/** Quantos caracteres do trecho vao no prompt. Curto por design. */
export const SNIPPET_MAX_CHARS = 200;

const CALIBRATION_INSTRUCTION: Record<MailboxContext['calibration'], string> = {
  CONSERVATIVE:
    'Esta caixa é calibrada de forma CONSERVADORA. Na dúvida, prefira a categoria ' +
    'menos descartável e a prioridade mais alta. Só use SPAM ou DISPOSABLE quando ' +
    'tiver certeza. Esconder um e-mail legítimo custa muito mais caro que mostrar ruído.',
  BALANCED:
    'Esta caixa é calibrada de forma EQUILIBRADA. Use seu melhor julgamento, mas ' +
    'ainda assim prefira mostrar a esconder quando a confiança for baixa.',
  AGGRESSIVE:
    'Esta caixa é calibrada de forma AGRESSIVA: o usuário revisa os descartados e ' +
    'prefere uma caixa limpa. Pode usar PROMOTIONAL e DISPOSABLE com mais liberdade. ' +
    'Mesmo assim, SPAM continua exigindo certeza.',
};

export function buildSystemPrompt(context: MailboxContext): string {
  const partes: string[] = [];

  partes.push(
    'Você faz a triagem da caixa de e-mail de um profissional que administra vários ' +
      'negócios diferentes, cada um em uma caixa separada. Sua tarefa é classificar ' +
      'mensagens a partir de METADADOS apenas (remetente, assunto, trecho curto). ' +
      'Você não tem acesso ao corpo completo — isso é intencional.',
  );

  // O contexto do negocio e o que torna a mesma mensagem urgente numa caixa
  // e irrelevante em outra.
  const contextoNegocio: string[] = [];
  if (context.businessName) contextoNegocio.push(`Negócio: ${context.businessName}.`);
  if (context.role) contextoNegocio.push(`Papel do usuário: ${context.role}.`);
  if (context.objective) contextoNegocio.push(`Objetivo do usuário nesta caixa: ${context.objective}`);
  if (contextoNegocio.length > 0) {
    partes.push(`CONTEXTO DESTA CAIXA\n${contextoNegocio.join('\n')}`);
  }
  partes.push(`Endereço desta conta: ${context.accountEmail}`);

  partes.push(`CATEGORIAS (escolha exatamente uma)
- COBRANCA: fornecedor cobrando o usuário — boleto, fatura, nota fiscal, cobrança de
  assinatura ou mensalidade, aviso de vencimento, segunda via. São CONTAS A PAGAR.
  Não use para o usuário cobrando alguém, nem para recibo de pagamento já feito
  (isso é INFORMATIVE).
- NEEDS_REPLY: uma pessoa real espera uma resposta do usuário. Pergunta direta,
  proposta aguardando retorno, convite pedindo confirmação, cliente pedindo algo.
- INFORMATIVE: relevante, mas não exige ação — confirmação, recibo, relatório,
  notificação de sistema, resposta automática.
- PROMOTIONAL: marketing, newsletter, divulgação, lista de distribuição.
- SPAM: fraude, phishing, remetente desconhecido com pedido suspeito, golpe.
- DISPOSABLE: sem valor e sem risco de descartar.

PRIORIDADE
- URGENT: exige ação hoje (vencimento em 48h, cliente bloqueado, prazo estourando).
- HIGH: importante, exige ação esta semana.
- NORMAL: padrão.
- LOW: pode esperar indefinidamente.

needsReply: true apenas quando uma PESSOA espera resposta do usuário. Cobrança de
sistema automatizado não precisa de resposta (precisa de pagamento) — marque false.`);

  partes.push(CALIBRATION_INSTRUCTION[context.calibration]);

  if (context.urgentKeywords.length > 0) {
    partes.push(
      `Nesta caixa, estes termos indicam urgência: ${context.urgentKeywords.join(', ')}.`,
    );
  }

  partes.push(
    'Para cada mensagem devolva também: confidence (0 a 1, quão seguro você está) e ' +
      'reason (uma frase curta, em português, explicando a decisão — o usuário lê isso ' +
      'para poder discordar de forma informada). Quando a confiança for baixa, prefira ' +
      'a categoria menos destrutiva.',
  );

  return partes.join('\n\n');
}

/** Trunca preservando a informacao util e deixando o corte explicito. */
export function truncateSnippet(snippet: string | null | undefined, max = SNIPPET_MAX_CHARS): string {
  if (!snippet) return '';
  const limpo = snippet.replace(/\s+/g, ' ').trim();
  return limpo.length <= max ? limpo : `${limpo.slice(0, max)}…`;
}

/**
 * Serializa um lote para o prompt do usuario.
 *
 * Classificar em lote (e nao um por chamada) e o que mantem o custo e a
 * latencia razoaveis, e ainda deixa o modelo ver o contexto do conjunto —
 * cinco cobrancas do mesmo fornecedor no mesmo dia sao um sinal.
 */
export function buildBatchPrompt(inputs: TriageInput[]): string {
  const linhas = inputs.map((input, indice) => {
    const campos = [
      `[${indice}] id=${input.id}`,
      `de: ${input.fromName ? `${input.fromName} <${input.fromEmail ?? '?'}>` : (input.fromEmail ?? '?')}`,
      `assunto: ${input.subject ?? '(sem assunto)'}`,
      `recebido: ${input.receivedAt.toISOString()}`,
      `destinatário direto: ${input.isDirectRecipient ? 'sim' : 'não (cópia)'}`,
      `destinatários: ${input.recipientCount}`,
      `anexo: ${input.hasAttachments ? 'sim' : 'não'}`,
    ];
    const trecho = truncateSnippet(input.snippet);
    if (trecho) campos.push(`trecho: ${trecho}`);
    return campos.join('\n  ');
  });

  return `Classifique cada uma das ${inputs.length} mensagens abaixo. Devolva um resultado por mensagem, usando o mesmo id.\n\n${linhas.join('\n\n')}`;
}
