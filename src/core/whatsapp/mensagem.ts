/**
 * O que uma mensagem de WhatsApp quer dizer, em dinheiro.
 *
 * Puro: recebe texto, devolve uma PROPOSTA — nunca um lançamento. O canal
 * não tem remetente verificável como o e-mail, e uma frase digitada com
 * pressa ("paguei o fornecedor, 1.200") é palpite sobre intenção. Quem
 * confirma é você, no painel. Ver docs/11-whatsapp.md
 */

export type Direcao = 'SAIDA' | 'ENTRADA';

export interface PropostaDeTexto {
  /** Em centavos, SEM sinal — a direção é campo próprio. */
  amountCents?: number;
  direcao: Direcao;
  /** O que sobrou depois de tirar valor e verbo: quem/o quê. */
  descricao: string;
  /** Data mencionada ("ontem", "15/08"); ausente = quando a mensagem chegou. */
  data?: Date;
  /** 0..1. Texto sem valor legível tem confiança baixa por construção. */
  confianca: number;
  /** Por que entendeu assim, para a tela mostrar. */
  motivo: string;
}

/** Verbos que indicam dinheiro saindo, e entrando. */
const SAIDA = /\b(paguei|pago|pagamento|paguei\s+o|gastei|comprei|transferi|enviei|saiu|debitei)\b/i;
const ENTRADA = /\b(recebi|recebido|entrou|caiu|me\s+pagou|deposit(ei|aram)|creditei)\b/i;

/**
 * Valor em real, nos formatos que uma pessoa digita:
 * "1.200", "1200", "1.234,56", "R$ 89,90", "89,90", "1,2k", "1200,00".
 */
const RE_VALOR = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k|mil)?\b/gi;

/** Datas escritas à mão: 15/08, 15/08/26, ontem, hoje, anteontem. */
const RE_DATA = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

/**
 * Teto do valor: o que cabe num `Int` do Postgres (R$ 21.474.836,47).
 *
 * Não é preciosismo de tipo. Uma frase de WhatsApp com dezesseis dígitos é
 * uma CHAVE — linha de boleto, chave PIX, número de documento —, nunca
 * dinheiro. Sem este teto ela virava um número que o banco recusa, a
 * gravação estourava, e o webhook devolvia 500; o Twilio então reentrega
 * para sempre e a mensagem nunca aparece. Foi o que aconteceu em produção.
 */
export const MAX_CENTAVOS = 2_147_483_647;

/** O valor cabe na coluna? Usado também na leitura de PDF. */
export function valorCabe(cents: number | undefined): cents is number {
  return cents !== undefined && Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTAVOS;
}

function paraCentavos(bruto: string, sufixo?: string): number | undefined {
  let texto = bruto.trim();

  // "1.200" é mil e duzentos, não um vírgula dois: ponto com três dígitos
  // depois é separador de milhar em português.
  const temMilhar = /\.\d{3}(?:\D|$)/.test(texto);
  if (temMilhar) texto = texto.replace(/\./g, '');
  texto = texto.replace(',', '.');

  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero <= 0) return undefined;

  const multiplicador = sufixo ? 1000 : 1;
  const cents = Math.round(numero * multiplicador * 100);
  // Acima do teto não é valor: é código. Devolver `undefined` faz a frase
  // cair no caminho honesto — "não achei um valor" — em vez de estourar.
  return valorCabe(cents) ? cents : undefined;
}

/**
 * O maior número da frase é o valor.
 *
 * Descartando o que claramente não é dinheiro: dia/mês de uma data, e
 * números com quatro dígitos que são ano. "paguei 1.200 dia 15/08" tem
 * três números; só um é o valor.
 */
function acharValor(texto: string): { cents: number; trecho: string } | undefined {
  const semData = texto.replace(RE_DATA, ' ');
  let melhor: { cents: number; trecho: string } | undefined;

  for (const m of semData.matchAll(RE_VALOR)) {
    const cents = paraCentavos(m[1]!, m[2]);
    if (cents === undefined) continue;
    // Ano solto ("2026") não é valor.
    if (/^(19|20)\d{2}$/.test(m[1]!) && !m[2]) continue;
    if (!melhor || cents > melhor.cents) melhor = { cents, trecho: m[0] };
  }
  return melhor;
}

function acharData(texto: string, agora: Date): { data: Date; trecho: string } | undefined {
  if (/\bhoje\b/i.test(texto)) return { data: agora, trecho: 'hoje' };
  if (/\bontem\b/i.test(texto)) {
    return { data: new Date(agora.getTime() - 24 * 3600 * 1000), trecho: 'ontem' };
  }
  if (/\banteontem\b/i.test(texto)) {
    return { data: new Date(agora.getTime() - 48 * 3600 * 1000), trecho: 'anteontem' };
  }

  const m = RE_DATA.exec(texto);
  if (!m) return undefined;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return undefined;

  const anoBruto = m[3] ? Number(m[3]) : undefined;
  const ano = anoBruto === undefined ? agora.getUTCFullYear() : anoBruto < 100 ? 2000 + anoBruto : anoBruto;
  // Meio-dia de Brasília, como no resto do app.
  const data = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0));
  if (data.getUTCMonth() !== mes - 1) return undefined; // 31/02
  return { data, trecho: m[0] };
}

const RUIDO_DESCRICAO = /\b(paguei|pago|pagamento|gastei|comprei|transferi|enviei|recebi|recebido|entrou|caiu|deposit\w+|reais?|de|do|da|para|pro|pra|no|na|em|o|a|um|uma|dia)\b/gi;

export function interpretarTexto(texto: string, agora = new Date()): PropostaDeTexto {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  const ehEntrada = ENTRADA.test(limpo);
  const ehSaida = SAIDA.test(limpo);

  const valor = acharValor(limpo);
  const data = acharData(limpo, agora);

  // Tira valor e data do texto para sobrar QUEM.
  let descricao = limpo;
  if (valor) descricao = descricao.replace(valor.trecho, ' ');
  if (data) descricao = descricao.replace(data.trecho, ' ');
  descricao = descricao
    .replace(RUIDO_DESCRICAO, ' ')
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const partes: string[] = [];
  if (valor) partes.push('valor lido');
  else partes.push('sem valor no texto');
  if (ehEntrada || ehSaida) partes.push(ehEntrada ? 'verbo de entrada' : 'verbo de saída');
  else partes.push('sem verbo — assumido saída');
  if (data) partes.push('data no texto');

  // Sem valor não há proposta útil; com valor mas sem verbo, ainda dá para
  // propor, com confiança menor. Nunca 1: isto é interpretação de frase.
  const confianca = !valor ? 0.2 : ehEntrada || ehSaida ? 0.7 : 0.5;

  return {
    amountCents: valor?.cents,
    // Sem verbo, saída é o palpite mais provável (a maioria das mensagens
    // é "paguei tal coisa") e o mais barato de corrigir.
    direcao: ehEntrada ? 'ENTRADA' : 'SAIDA',
    descricao: descricao || '(sem descrição)',
    data: data?.data,
    confianca,
    motivo: partes.join(' · '),
  };
}
