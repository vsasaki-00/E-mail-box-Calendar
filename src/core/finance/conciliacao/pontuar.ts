import { normalizarDescricao } from '../extrato/normalizar';

/**
 * Pontuacao de um par (lancamento do extrato, cobranca detectada no e-mail).
 *
 * Conciliacao e casamento de registros com todos os problemas do genero:
 * valor bate mas a data nao; a descricao do extrato nao se parece com o
 * beneficiario do boleto; juros mudam o valor; dois boletos do mesmo valor
 * no mesmo mes. Por isso NADA aqui decide — so pontua e explica. Quem
 * confirma e voce. Ver docs/10-financeiro.md
 *
 * Tres sinais, com pesos que somam 1:
 *   valor      0.55 — o mais forte, mas sozinho nao basta (dois boletos de
 *                     R$ 59,90 no mesmo mes sao comuns);
 *   data       0.25 — pagamento perto do vencimento;
 *   nome       0.20 — beneficiario x descricao do extrato.
 * Mais um bonus pequeno quando o TIPO combina (boleto x "pagamento de
 * boleto", pix x "pix").
 */

export interface LancamentoParaConciliar {
  id: string;
  postedAt: Date;
  /** Negativo (saida). */
  amountCents: number;
  description: string;
  normalized: string;
}

export interface CobrancaParaConciliar {
  id: string;
  amountCents: number;
  dueDate: Date | null;
  /** Quando o e-mail chegou: fallback de data quando nao ha vencimento. */
  receivedAt: Date;
  payee: string | null;
  kind: string;
}

export interface Pontuacao {
  /** 0..1 */
  confianca: number;
  /** Em linguagem de gente, para a tela. */
  motivo: string;
}

const PESO_VALOR = 0.55;
const PESO_DATA = 0.25;
const PESO_NOME = 0.2;
const BONUS_TIPO = 0.05;

/** Abaixo disto nem vira sugestao. */
export const CONFIANCA_MINIMA = 0.6;

const DIA_MS = 24 * 3600 * 1000;

/** Juros e multa de atraso: ate 3% acima, ou R$ 5, o que for maior. */
function pontuarValor(pago: number, devido: number): { nota: number; texto: string } {
  if (pago === devido) return { nota: 1, texto: 'valor igual' };
  const diferenca = pago - devido;
  const tolerancia = Math.max(Math.round(devido * 0.03), 500);
  if (diferenca > 0 && diferenca <= tolerancia) {
    return { nota: 0.85, texto: `valor ${(diferenca / 100).toFixed(2).replace('.', ',')} acima (juros?)` };
  }
  if (diferenca < 0 && -diferenca <= tolerancia) {
    return { nota: 0.75, texto: `valor ${(-diferenca / 100).toFixed(2).replace('.', ',')} abaixo (desconto?)` };
  }
  return { nota: 0, texto: 'valor diferente' };
}

/**
 * Pagamento em dia ou ate 5 dias adiantado: cheio. Ate 30 dias depois do
 * vencimento: decai. Fora disso: zero — nao e este pagamento.
 */
function pontuarData(pago: Date, vencimento: Date | null, recebido: Date): { nota: number; texto: string } {
  const referencia = vencimento ?? recebido;
  const dias = Math.round((pago.getTime() - referencia.getTime()) / DIA_MS);
  const rotulo = vencimento ? 'vencimento' : 'e-mail';

  if (dias >= -5 && dias <= 1) return { nota: 1, texto: dias === 0 ? `no dia do ${rotulo}` : `${Math.abs(dias)} dia(s) ${dias < 0 ? 'antes' : 'depois'} do ${rotulo}` };
  // Decai ate quase zero em 30 dias: valor igual sozinho, pago tres semanas
  // depois, fica abaixo do minimo — sem nome batendo, e chute.
  if (dias > 1 && dias <= 30) return { nota: 1 - (dias - 1) / 30, texto: `${dias} dias depois do ${rotulo}` };
  if (dias < -5 && dias >= -15) return { nota: 0.6, texto: `${-dias} dias antes do ${rotulo}` };
  return { nota: 0, texto: `${Math.abs(dias)} dias ${dias < 0 ? 'antes' : 'depois'} do ${rotulo}` };
}

const PALAVRAS_VAZIAS = new Set(['ltda', 'sa', 's', 'a', 'me', 'eireli', 'epp', 'de', 'do', 'da', 'e', 'com', 'br', 'cia']);

export function tokens(texto: string): string[] {
  return normalizarDescricao(texto)
    .split(' ')
    .filter((t) => t.length >= 3 && !PALAVRAS_VAZIAS.has(t));
}

/** Fracao dos tokens do beneficiario que aparecem na descricao. */
function pontuarNome(payee: string | null, descricaoNormalizada: string): { nota: number; texto: string } {
  if (!payee) return { nota: 0, texto: '' };
  const alvo = tokens(payee);
  if (alvo.length === 0) return { nota: 0, texto: '' };
  const presentes = new Set(descricaoNormalizada.split(' '));
  const achados = alvo.filter((t) => presentes.has(t));
  const nota = achados.length / alvo.length;
  if (nota === 0) return { nota: 0, texto: '' };
  return { nota, texto: nota === 1 ? 'nome bate' : `nome parcial (${achados.join(' ')})` };
}

function tipoCombina(kind: string, descricao: string): boolean {
  const d = descricao.toLowerCase();
  if (kind === 'BOLETO') return /boleto/.test(d);
  if (kind === 'PIX') return /\bpix\b/.test(d);
  return false;
}

export function pontuarPar(lancamento: LancamentoParaConciliar, cobranca: CobrancaParaConciliar): Pontuacao {
  const pago = Math.abs(lancamento.amountCents);
  const valor = pontuarValor(pago, cobranca.amountCents);
  if (valor.nota === 0) return { confianca: 0, motivo: valor.texto };

  const data = pontuarData(lancamento.postedAt, cobranca.dueDate, cobranca.receivedAt);
  if (data.nota === 0) return { confianca: 0, motivo: `${valor.texto}, mas ${data.texto}` };

  const nome = pontuarNome(cobranca.payee, lancamento.normalized);
  const bonus = tipoCombina(cobranca.kind, lancamento.description) ? BONUS_TIPO : 0;

  const confianca = Math.min(1, PESO_VALOR * valor.nota + PESO_DATA * data.nota + PESO_NOME * nome.nota + bonus);
  const partes = [valor.texto, data.texto, nome.texto, bonus ? 'tipo combina' : ''].filter(Boolean);
  return { confianca: Math.round(confianca * 100) / 100, motivo: partes.join(' · ') };
}

export interface ParSugerido {
  lancamentoId: string;
  cobrancaId: string;
  confianca: number;
  motivo: string;
}

/**
 * Um lancamento para uma cobranca, e vice-versa: os melhores pares primeiro,
 * e cada lado so entra uma vez. Guloso e suficiente aqui — o volume e de
 * dezenas por mes, e a ambiguidade real (dois boletos iguais) fica para
 * voce, com o motivo na tela.
 */
export function escolherPares(
  lancamentos: LancamentoParaConciliar[],
  cobrancas: CobrancaParaConciliar[],
  minimo = CONFIANCA_MINIMA,
): ParSugerido[] {
  const candidatos: ParSugerido[] = [];
  for (const l of lancamentos) {
    for (const c of cobrancas) {
      const p = pontuarPar(l, c);
      if (p.confianca >= minimo) {
        candidatos.push({ lancamentoId: l.id, cobrancaId: c.id, confianca: p.confianca, motivo: p.motivo });
      }
    }
  }
  candidatos.sort((a, b) => b.confianca - a.confianca);

  const usadosL = new Set<string>();
  const usadosC = new Set<string>();
  const escolhidos: ParSugerido[] = [];
  for (const par of candidatos) {
    if (usadosL.has(par.lancamentoId) || usadosC.has(par.cobrancaId)) continue;
    usadosL.add(par.lancamentoId);
    usadosC.add(par.cobrancaId);
    escolhidos.push(par);
  }
  return escolhidos;
}
