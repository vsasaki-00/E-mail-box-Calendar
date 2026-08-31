import type { VoiceForDraft } from './compose';
import type { DraftInput, DraftMailboxContext } from './types';

/**
 * Prompt do rascunho (fase 5D). Ver docs/07-agente-de-triagem.md
 *
 * Funcao pura, para poder ser testada — inclusive o que ela NAO pode
 * conter. O perfil de outra caixa entrar aqui faria voce responder um
 * cliente da Unitedcom com a voz que usa no e-mail pessoal.
 */

export const DRAFT_PROMPT_VERSION = 'draft-1';

const FORMALIDADE: Record<string, string> = {
  formal: 'formal',
  neutro: 'neutro',
  informal: 'informal e direto',
};

export function buildDraftSystemPrompt(
  contexto: DraftMailboxContext,
  voz: VoiceForDraft,
): string {
  const linhas: string[] = [
    'Você escreve o MIOLO de uma resposta de e-mail, no lugar do usuário.',
    '',
    '## Regras de formato (importantes)',
    '',
    '- NÃO escreva saudação ("Oi Fulano,"). Ela é adicionada automaticamente.',
    '- NÃO escreva despedida ("Abraço,", "Atenciosamente,"). Idem.',
    '- NÃO escreva assinatura nem nome. Idem.',
    '- Escreva apenas o conteúdo entre a saudação e a despedida.',
    '- Não invente fato, número, data, valor ou compromisso que não esteja',
    '  na mensagem original ou na instrução do usuário. Se falta informação',
    '  para responder, escreva uma resposta que PEDE essa informação.',
    '',
    '## Como este usuário escreve nesta caixa',
    '',
  ];

  if (voz.language) linhas.push(`- Idioma: ${voz.language}.`);
  if (voz.formality) {
    linhas.push(`- Registro: ${FORMALIDADE[voz.formality] ?? voz.formality}.`);
  }
  if (voz.medianWordCount > 0) {
    linhas.push(
      `- Tamanho típico das mensagens dele: ${voz.medianWordCount} palavras. ` +
        'Fique perto disso — mensagem longa demais não parece dele.',
    );
  }
  for (const traco of voz.traits) linhas.push(`- ${traco}`);
  if (voz.userNotes) {
    // A observacao do usuario vem por ultimo e e a que manda: foi ele que
    // escreveu, olhando o perfil derivado, e corrigindo o que estava errado.
    linhas.push('', `## Correção do próprio usuário sobre o perfil acima`, '', voz.userNotes);
  }

  linhas.push('', '## Contexto desta caixa', '');
  linhas.push(`- Conta: ${contexto.accountEmail}`);
  if (contexto.businessName) linhas.push(`- Negócio: ${contexto.businessName}`);
  if (contexto.role) linhas.push(`- Papel do usuário neste negócio: ${contexto.role}`);
  if (contexto.objective) linhas.push(`- Objetivo do usuário nesta caixa: ${contexto.objective}`);

  linhas.push(
    '',
    '## O que você NÃO faz',
    '',
    '- Não envia nada. O rascunho vai para o usuário aprovar.',
    '- Não promete prazo, preço ou entrega que o usuário não tenha dito.',
    '- Não assume autoridade que o papel acima não dá.',
  );

  return linhas.join('\n');
}

/** Quanto do e-mail original entra no prompt. */
export const MAX_THREAD_CHARS = 6000;

export function buildDraftUserPrompt(input: DraftInput): string {
  const partes = [
    '<mensagem-a-responder>',
    `De: ${input.fromName ?? ''} <${input.fromEmail ?? ''}>`,
    `Assunto: ${input.subject ?? '(sem assunto)'}`,
    `Recebida em: ${input.receivedAt.toISOString().slice(0, 10)}`,
    '',
    input.body.slice(0, MAX_THREAD_CHARS),
    '</mensagem-a-responder>',
  ];

  if (input.direction?.trim()) {
    partes.push(
      '',
      '<instrução-do-usuário>',
      // A instrucao do usuario tem precedencia sobre o que o modelo acharia
      // sozinho: ele sabe do negocio o que o e-mail nao diz.
      'Isto é o que o usuário quer nesta resposta. Tem precedência:',
      input.direction.trim(),
      '</instrução-do-usuário>',
    );
  }

  return partes.join('\n');
}
