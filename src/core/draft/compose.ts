/**
 * Composicao do rascunho a partir do perfil de voz (fase 5D).
 *
 * Ver docs/07-agente-de-triagem.md. A decisao de projeto desta fase, e ela
 * segue a mesma logica da 5B (o que pode ser deterministico, e):
 *
 * **O modelo escreve so o MIOLO. Saudacao, despedida e assinatura sao
 * montadas localmente, a partir do perfil que voce validou.**
 *
 * Por que isso importa:
 *  - a assinatura sai EXATA, caractere por caractere — nao uma parafrase
 *    que o modelo achou parecida com a sua;
 *  - a despedida e a que voce mais usa, contada da sua pasta Enviados;
 *  - a saudacao segue o seu padrao real ("Oi {nome},", "Prezado {nome},");
 *  - e o perfil de voz deixa de ser tempero de prompt e passa a fazer
 *    trabalho mecanico verificavel.
 */

import { isClosingLine } from '@/core/voice/extract';

export interface VoiceForDraft {
  greetings: { text: string; count: number }[];
  closings: { text: string; count: number }[];
  signature: string | null;
  language: string | null;
  formality: string | null;
  medianWordCount: number;
  traits: string[];
  userNotes: string | null;
}

/** Nome proprio a partir do remetente, para entrar na saudacao. */
export function firstName(fromName?: string | null, fromEmail?: string | null): string | null {
  const bruto = fromName?.trim();
  if (bruto && !bruto.includes('@')) {
    const primeiro = bruto.split(/\s+/)[0];
    if (primeiro && primeiro.length > 1) return primeiro;
  }

  const local = fromEmail?.split('@')[0];
  if (!local) return null;
  // "joao.silva" -> "Joao". Enderecos de sistema nao viram nome.
  const parte = local.split(/[._-]/)[0];
  if (!parte || parte.length < 2 || /^\d+$/.test(parte)) return null;
  if (/^(no|nao|nreply|noreply|contato|financeiro|suporte|atendimento|billing|info|admin)$/i.test(parte)) {
    return null;
  }
  return parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase();
}

/** A saudacao mais usada, com o nome de quem escreveu encaixado. */
export function buildGreeting(voz: VoiceForDraft, nome: string | null): string | null {
  const preferida = [...voz.greetings].sort((a, b) => b.count - a.count)[0]?.text;
  if (!preferida) return null;

  // A saudacao aprendida ja vem com um nome ("Oi Camila,"). Troca o nome
  // pelo do destinatario desta mensagem, mantendo a forma.
  const semNome = preferida.replace(/\s+[A-ZÀ-Ú][\wÀ-ú'-]*\s*([,!:.])?\s*$/u, '');
  const pontuacao = preferida.match(/([,!:.])\s*$/)?.[1] ?? ',';

  if (!nome) {
    // Sem nome, a saudacao vira so a forma ("Oi," / "Prezado,"). "Prezado,"
    // sozinho fica estranho, entao nesse caso melhor nao saudar.
    return /^(oi|olá|ola|bom dia|boa tarde|boa noite|hi|hello|hey)$/i.test(semNome.trim())
      ? `${semNome.trim()}${pontuacao}`
      : null;
  }

  return `${semNome.trim()} ${nome}${pontuacao}`;
}

/** A despedida mais usada. */
export function buildClosing(voz: VoiceForDraft): string | null {
  return [...voz.closings].sort((a, b) => b.count - a.count)[0]?.text ?? null;
}

/**
 * Saudacao que o modelo escreveu mesmo depois de ter sido instruido a nao
 * escrever. Defesa em profundidade: sem isso o rascunho sai com "Oi
 * Camila," duas vezes, e nada denuncia mais uma resposta automatica.
 */
const SAUDACAO_INICIAL =
  /^\s*(oi|olá|ola|bom dia|boa tarde|boa noite|prezad[oa]s?|car[oa]|e aí|hi|hello|hey|dear)\b[^\n]{0,40}[,!:]\s*\n+/i;

/** Quantas linhas finais podem conter a despedida do modelo. */
const JANELA_DE_DESPEDIDA = 4;

/**
 * Tira do miolo a saudacao e a despedida (com o que vier depois dela) que o
 * modelo possa ter incluido.
 *
 * A despedida e localizada por LINHA, e nao por regex de fim de texto: o
 * modelo costuma escrever "Abraço,\nVictor", entao a despedida quase nunca
 * e a ultima linha. Achada a linha de despedida, tudo dela em diante sai —
 * e a composicao devolve a SUA despedida e a SUA assinatura no lugar.
 *
 * Usa o mesmo `isClosingLine` que derivou o perfil de voz: duas listas
 * separadas divergiriam e a duplicacao voltaria.
 */
export function stripGreetingAndClosing(corpo: string): string {
  const texto = corpo.replace(/\r\n/g, '\n').trim().replace(SAUDACAO_INICIAL, '');

  const linhas = texto.split('\n');
  const inicioDaJanela = Math.max(0, linhas.length - JANELA_DE_DESPEDIDA);
  for (let i = linhas.length - 1; i >= inicioDaJanela; i -= 1) {
    const linha = (linhas[i] ?? '').trim();
    if (linha && isClosingLine(linha)) return linhas.slice(0, i).join('\n').trim();
  }

  return texto.trim();
}

export interface ComposedDraft {
  text: string;
  greeting: string | null;
  closing: string | null;
  signature: string | null;
}

/**
 * Monta o texto final: saudacao + miolo + despedida + assinatura.
 *
 * Cada peca so entra se existir no perfil. Um perfil magro produz um
 * rascunho magro e honesto, nao um rascunho com partes inventadas.
 */
export function composeDraft(
  miolo: string,
  voz: VoiceForDraft,
  destinatario: { fromName?: string | null; fromEmail?: string | null },
): ComposedDraft {
  const nome = firstName(destinatario.fromName, destinatario.fromEmail);
  const greeting = buildGreeting(voz, nome);
  const closing = buildClosing(voz);
  const corpo = stripGreetingAndClosing(miolo);

  const partes: string[] = [];
  if (greeting) partes.push(greeting);
  if (corpo) partes.push(corpo);
  if (closing) partes.push(closing);
  // A assinatura vem colada na despedida, como numa mensagem de verdade.
  if (voz.signature) {
    if (closing) partes[partes.length - 1] = `${closing}\n${voz.signature}`;
    else partes.push(voz.signature);
  }

  return { text: partes.join('\n\n'), greeting, closing, signature: voz.signature };
}
