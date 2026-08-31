/**
 * Derivacao do perfil de voz a partir da pasta Enviados.
 *
 * Ver docs/07-agente-de-triagem.md — a ideia central da fase 5C: o usuario
 * ja tem milhares de exemplos de como escreve, e eles ja sao DIFERENTES por
 * caixa, que e exatamente a distincao pedida ("negocios diferentes").
 * Formulario de "descreva seu tom" produz resultado ruim; a pasta Enviados,
 * nao.
 *
 * Tudo aqui e funcao pura. O trabalho dificil e separar o que o usuario
 * realmente escreveu do que veio citado — sem isso o perfil aprende a voz
 * dos outros.
 */

export interface SentMessageSample {
  id: string;
  subject?: string | null;
  /** Corpo em texto puro, ja extraido do MIME. */
  body: string;
  sentAt: Date;
  /** Quantos destinatarios. Difusao interna tem voz diferente de 1:1. */
  recipientCount: number;
}

export interface VoiceProfileDraft {
  greetings: { text: string; count: number }[];
  closings: { text: string; count: number }[];
  signature: string | null;
  avgWordCount: number;
  medianWordCount: number;
  formality: 'formal' | 'neutro' | 'informal' | null;
  language: string | null;
  traits: string[];
  sampleCount: number;
  /** Mensagens descartadas e por que — o usuario precisa poder auditar. */
  rejected: { id: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Separacao do texto autoral
// ---------------------------------------------------------------------------

/**
 * Marcadores que iniciam o trecho citado. A partir da primeira ocorrencia,
 * nada mais e do usuario.
 *
 * Cobre Gmail e Outlook, em portugues e ingles — as combinacoes que
 * aparecem de verdade nas caixas brasileiras.
 */
const MARCADORES_DE_CITACAO: RegExp[] = [
  /^\s*Em\s+.{0,80}\s+escreveu:\s*$/im,
  /^\s*On\s+.{0,80}\s+wrote:\s*$/im,
  /^\s*-{2,}\s*Mensagem original\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^\s*De:\s*.+$/im,
  /^\s*From:\s*.+$/im,
  /^\s*_{10,}\s*$/m,
];

/**
 * Devolve so o que o usuario escreveu, cortando no primeiro marcador de
 * citacao e removendo linhas prefixadas com ">".
 */
export function extractAuthoredText(body: string): string {
  let texto = body.replace(/\r\n/g, '\n');

  let corteMaisCedo = texto.length;
  for (const marcador of MARCADORES_DE_CITACAO) {
    const encontrado = texto.match(marcador);
    if (encontrado?.index !== undefined && encontrado.index < corteMaisCedo) {
      corteMaisCedo = encontrado.index;
    }
  }
  texto = texto.slice(0, corteMaisCedo);

  return texto
    .split('\n')
    .filter((linha) => !/^\s*>/.test(linha))
    .join('\n')
    .trim();
}

export function countWords(texto: string): number {
  const limpo = texto.trim();
  return limpo ? limpo.split(/\s+/).length : 0;
}

/** Abaixo disso a mensagem nao ensina nada sobre como o usuario escreve. */
export const MIN_AUTHORED_WORDS = 12;

/**
 * Uma amostra so entra no perfil se for texto autoral de tamanho util.
 *
 * Sem esse filtro, o perfil aprende que o usuario escreve "ok" e
 * "recebido, obrigado" o tempo todo — porque encaminhamentos e
 * confirmacoes dominam a pasta Enviados em volume.
 */
export function isUsableSample(sample: SentMessageSample): { usable: boolean; reason?: string } {
  const assunto = sample.subject?.trim().toLowerCase() ?? '';
  if (/^(enc:|fwd:|fw:|encaminhada:)/.test(assunto)) {
    return { usable: false, reason: 'Encaminhamento: o texto não é autoral' };
  }

  const autoral = extractAuthoredText(sample.body);
  const palavras = countWords(autoral);
  if (palavras < MIN_AUTHORED_WORDS) {
    return { usable: false, reason: `Texto autoral curto demais (${palavras} palavras)` };
  }

  return { usable: true };
}

// ---------------------------------------------------------------------------
// Saudacao, despedida e assinatura
// ---------------------------------------------------------------------------

const SAUDACOES = [
  'oi',
  'olá',
  'ola',
  'bom dia',
  'boa tarde',
  'boa noite',
  'prezado',
  'prezada',
  'prezados',
  'caro',
  'cara',
  'e aí',
  'e ai',
  'fala',
  'hi',
  'hello',
  'hey',
  'dear',
];

const DESPEDIDAS = [
  'abraço',
  'abraco',
  'abraços',
  'abracos',
  'att',
  'atenciosamente',
  'obrigado',
  'obrigada',
  'grato',
  'grata',
  'até mais',
  'ate mais',
  'valeu',
  'forte abraço',
  'cordialmente',
  'best',
  'regards',
  'thanks',
  'cheers',
];

/** Primeira linha nao-vazia, quando ela e uma saudacao reconhecida. */
export function extractGreeting(autoral: string): string | null {
  const primeira = autoral.split('\n').find((l) => l.trim().length > 0)?.trim();
  if (!primeira) return null;

  // A saudacao e curta por natureza; uma frase longa nao e saudacao.
  if (countWords(primeira) > 6) return null;

  const normalizada = primeira.toLowerCase().replace(/[,!.:;]+$/, '');
  const casa = SAUDACOES.some(
    (s) => normalizada === s || normalizada.startsWith(`${s} `) || normalizada.startsWith(`${s},`),
  );
  return casa ? primeira.replace(/\s+/g, ' ') : null;
}

/** Linhas nao-vazias, ja aparadas. */
function linhasUteis(autoral: string): string[] {
  return autoral
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Uma linha isolada e uma despedida reconhecida? */
function isClosingLine(linha: string): boolean {
  // A despedida e curta por natureza; uma frase nao e despedida.
  if (countWords(linha) > 5) return false;
  const normalizada = linha.toLowerCase().replace(/[,!.:;]+$/, '');
  return DESPEDIDAS.some(
    (d) => normalizada === d || normalizada.startsWith(`${d} `) || normalizada.startsWith(`${d},`),
  );
}

/** Quantas linhas finais podem conter a despedida. */
const JANELA_DE_DESPEDIDA = 5;

/**
 * Ultima linha curta que seja uma despedida reconhecida. Procura de tras
 * para frente, pulando o que parece bloco de assinatura.
 */
export function extractClosing(autoral: string): string | null {
  const linhas = linhasUteis(autoral);

  // Olha so as ultimas linhas: despedida nao fica no meio do texto.
  for (const linha of linhas.slice(-JANELA_DE_DESPEDIDA).reverse()) {
    if (isClosingLine(linha)) return linha.replace(/\s+/g, ' ');
  }
  return null;
}

/**
 * Linhas que podem fazer parte da assinatura: o que vem DEPOIS da despedida.
 *
 * Sem esse corte, "Abraço," entra no bloco repetido e a assinatura detectada
 * vira "Abraço,\nVictor Sasaki\nBrand.co" — a despedida contada duas vezes,
 * ja que ela tem campo proprio. Na hora de montar o rascunho (fase 5D) isso
 * produziria "Abraço," duplicado.
 */
function linhasDeAssinatura(autoral: string): string[] {
  const linhas = linhasUteis(autoral);

  const inicioDaJanela = Math.max(0, linhas.length - JANELA_DE_DESPEDIDA);
  for (let i = linhas.length - 1; i >= inicioDaJanela; i -= 1) {
    if (isClosingLine(linhas[i] as string)) return linhas.slice(i + 1);
  }
  return linhas;
}

/**
 * Assinatura = bloco final que se repete em varias mensagens.
 *
 * Detectar por repeticao (e nao por regra "depois do --") e o que funciona
 * na pratica: pouca gente usa o separador padrao, mas todo mundo repete o
 * mesmo bloco.
 *
 * A despedida fica de fora: ela e um campo separado do perfil.
 */
export function detectSignature(amostras: string[], minRepeticoes = 3): string | null {
  if (amostras.length < minRepeticoes) return null;

  const contagem = new Map<string, number>();
  for (const autoral of amostras) {
    const linhas = linhasDeAssinatura(autoral);
    // Blocos de 1 a 4 linhas finais sao candidatos. Uma linha so vale como
    // candidato porque, sem a despedida, "Victor Sasaki" sozinho ja e uma
    // assinatura legitima — e repetir 3x continua sendo a exigencia real.
    for (let tamanho = 1; tamanho <= 4; tamanho += 1) {
      if (linhas.length < tamanho) break;
      const bloco = linhas.slice(-tamanho).join('\n');
      if (countWords(bloco) > 30) continue;
      contagem.set(bloco, (contagem.get(bloco) ?? 0) + 1);
    }
  }

  let melhor: { bloco: string; vezes: number } | null = null;
  for (const [bloco, vezes] of contagem) {
    if (vezes < minRepeticoes) continue;
    // Entre blocos igualmente repetidos, o maior e a assinatura completa.
    if (!melhor || vezes > melhor.vezes || (vezes === melhor.vezes && bloco.length > melhor.bloco.length)) {
      melhor = { bloco, vezes };
    }
  }

  return melhor?.bloco ?? null;
}

// ---------------------------------------------------------------------------
// Registro e idioma
// ---------------------------------------------------------------------------

const MARCADORES_FORMAIS = ['prezado', 'prezada', 'atenciosamente', 'cordialmente', 'venho por meio', 'solicito'];
const MARCADORES_INFORMAIS = ['oi', 'e aí', 'e ai', 'valeu', 'abraço', 'abraco', 'fala', 'beleza', 'blz'];

export function detectFormality(amostras: string[]): 'formal' | 'neutro' | 'informal' | null {
  if (amostras.length === 0) return null;

  let formal = 0;
  let informal = 0;
  for (const texto of amostras) {
    const t = texto.toLowerCase();
    if (MARCADORES_FORMAIS.some((m) => t.includes(m))) formal += 1;
    if (MARCADORES_INFORMAIS.some((m) => t.includes(m))) informal += 1;
  }

  const total = amostras.length;
  if (formal / total > 0.4 && formal > informal) return 'formal';
  if (informal / total > 0.4 && informal > formal) return 'informal';
  return 'neutro';
}

/**
 * Palavras funcionais que so existem em portugues.
 *
 * Deliberadamente SEM as ambiguas com ingles — "do", "no", "a", "o", "e",
 * "se" sao palavras validas nos dois idiomas e envenenariam a contagem.
 * A lista precisa ser larga: um e-mail curto de negocio pode nao conter
 * nenhuma das palavras mais obvias ("que", "não", "para").
 */
const PALAVRAS_PT =
  /\b(de|da|das|dos|na|nas|nos|em|um|uma|uns|umas|que|não|nao|para|com|por|ser|está|esta|estão|são|sao|como|mais|mas|ao|à|às|pelo|pela|seu|sua|meu|minha|isso|este|esta|já|ja|também|tambem|quando|onde|até|ate|vou|segue|conforme|obrigado|obrigada|você|voce|preciso|qualquer|coisa)\b/g;

/** Palavras funcionais que so existem em ingles. */
const PALAVRAS_EN =
  /\b(the|and|you|for|with|this|that|are|is|was|were|have|has|will|would|can|could|but|not|from|they|we|our|your|please|thanks|about|there|then|been|which)\b/g;

/**
 * Deteccao grosseira de idioma por palavras funcionais. Suficiente para
 * escolher o idioma do rascunho — nao pretende ser um classificador geral.
 */
export function detectLanguage(amostras: string[]): string | null {
  if (amostras.length === 0) return null;

  const texto = amostras.join(' ').toLowerCase();
  const pt = (texto.match(PALAVRAS_PT) ?? []).length;
  const en = (texto.match(PALAVRAS_EN) ?? []).length;

  if (pt === 0 && en === 0) return null;
  return pt >= en ? 'pt-BR' : 'en';
}

function median(numeros: number[]): number {
  if (numeros.length === 0) return 0;
  const ordenados = [...numeros].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? Math.round(((ordenados[meio - 1] ?? 0) + (ordenados[meio] ?? 0)) / 2)
    : (ordenados[meio] ?? 0);
}

function topN(contagem: Map<string, number>, n: number): { text: string; count: number }[] {
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([text, count]) => ({ text, count }));
}

/** Quantas amostras utilizaveis sao necessarias para o perfil valer algo. */
export const MIN_SAMPLES_FOR_PROFILE = 5;

/**
 * Monta o perfil de voz. Nunca lanca: caixa com pouco material devolve um
 * perfil magro e honesto (`sampleCount` baixo), que a UI mostra como
 * "material insuficiente" em vez de fingir que aprendeu.
 */
export function buildVoiceProfile(amostras: SentMessageSample[]): VoiceProfileDraft {
  const rejected: { id: string; reason: string }[] = [];
  const autorais: string[] = [];
  const contagens: number[] = [];
  const saudacoes = new Map<string, number>();
  const despedidas = new Map<string, number>();

  for (const amostra of amostras) {
    const veredito = isUsableSample(amostra);
    if (!veredito.usable) {
      rejected.push({ id: amostra.id, reason: veredito.reason ?? 'descartada' });
      continue;
    }

    const autoral = extractAuthoredText(amostra.body);
    autorais.push(autoral);
    contagens.push(countWords(autoral));

    const saudacao = extractGreeting(autoral);
    if (saudacao) saudacoes.set(saudacao, (saudacoes.get(saudacao) ?? 0) + 1);

    const despedida = extractClosing(autoral);
    if (despedida) despedidas.set(despedida, (despedidas.get(despedida) ?? 0) + 1);
  }

  const traits: string[] = [];
  const media = contagens.length > 0 ? Math.round(contagens.reduce((s, n) => s + n, 0) / contagens.length) : 0;
  if (media > 0 && media < 40) traits.push('Escreve mensagens curtas e diretas');
  if (media >= 120) traits.push('Escreve mensagens longas e detalhadas');
  if (saudacoes.size === 0 && autorais.length >= MIN_SAMPLES_FOR_PROFILE) {
    traits.push('Costuma começar direto no assunto, sem saudação');
  }

  return {
    greetings: topN(saudacoes, 5),
    closings: topN(despedidas, 5),
    signature: detectSignature(autorais),
    avgWordCount: media,
    medianWordCount: median(contagens),
    formality: detectFormality(autorais),
    language: detectLanguage(autorais),
    traits,
    sampleCount: autorais.length,
    rejected,
  };
}
