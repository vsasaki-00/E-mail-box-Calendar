/**
 * Leitura de valores e datas em portugues do corpo do e-mail.
 *
 * Ver docs/07-agente-de-triagem.md (fase 5B). Serve para os casos SEM
 * instrumento de pagamento no corpo — fatura de cartao, aviso de assinatura,
 * cobranca que so anexa PDF. Quando ha boleto ou PIX, o instrumento manda:
 * ele carrega DV, e isto aqui nao.
 *
 * Nao substitui o modelo. Serve para dar ao modelo um ponto de partida
 * verificavel e para conferir o que ele devolveu.
 */

export interface AmountFound {
  cents: number;
  /** Como apareceu no texto, para o usuario conferir. */
  raw: string;
  /** Havia rotulo de total/valor perto? Aumenta a chance de ser O valor. */
  labeled: boolean;
}

/**
 * Valores em real. Aceita as formas que aparecem de verdade:
 * `R$ 1.234,56`, `R$ 89,90`, `1.234,56`, `R$1.234`.
 */
const VALOR = /(R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(,\d{2})?/g;

/** Rotulos que indicam que aquele numero e O valor a pagar. */
const ROTULO_DE_VALOR =
  /(valor|total|montante|a pagar|importe|cobran[çc]a|fatura|d[ée]bito)\D{0,20}$/i;

/**
 * Acha valores monetarios no texto.
 *
 * So aceita numero sem `R$` quando ele tem centavos E rotulo perto: sem
 * essa regra, "conforme conversamos em 2024" e todo numero de protocolo
 * viram dinheiro.
 */
export function findAmounts(texto: string): AmountFound[] {
  const achados: AmountFound[] = [];

  for (const m of texto.matchAll(VALOR)) {
    const [bruto, simbolo, inteiro, decimais] = m;
    if (inteiro === undefined) continue;

    const antes = texto.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    const labeled = ROTULO_DE_VALOR.test(antes);

    const temSimbolo = Boolean(simbolo);
    if (!temSimbolo && (!decimais || !labeled)) continue;

    const cents = Number(inteiro.replace(/\./g, '')) * 100 + Number(decimais?.slice(1) ?? 0);
    if (cents <= 0) continue;

    achados.push({ cents, raw: bruto.trim(), labeled: labeled || temSimbolo });
  }

  return achados;
}

const MESES: Record<string, number> = {
  janeiro: 0, fevereiro: 1, marco: 2, março: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

export interface DateFound {
  date: Date;
  raw: string;
  /** Havia rotulo de vencimento perto? */
  labeled: boolean;
}

const DATA_NUMERICA = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const DATA_POR_EXTENSO = /\b(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?\b/gi;

const ROTULO_DE_VENCIMENTO =
  /(vencimento|vence|vencer|v[eê]ncto|pagar at[ée]|pagamento at[ée]|v[áa]lido at[ée]|prazo|data limite|at[ée] o dia)\D{0,25}$/i;

/**
 * Constroi a data em UTC ao meio-dia.
 *
 * Meio-dia e proposital: vencimento e uma data, nao um instante, e
 * meia-noite UTC vira o dia anterior em Brasilia (UTC-3). Isso faria o
 * painel dizer que uma conta venceu um dia antes do que venceu.
 */
function emData(ano: number, mes: number, dia: number): Date | null {
  const d = new Date(Date.UTC(ano, mes, dia, 12));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes || d.getUTCDate() !== dia) return null;
  return d;
}

/** Ano de dois digitos: 26 -> 2026. */
function ano4(bruto: string | undefined, referencia: Date): number {
  if (!bruto) return referencia.getUTCFullYear();
  const n = Number(bruto);
  return bruto.length === 2 ? 2000 + n : n;
}

/**
 * Acha datas no texto, em formato numerico (dd/mm) e por extenso.
 *
 * `dd/mm` sempre — nunca `mm/dd`. O sistema e para caixas brasileiras, e
 * adivinhar a ordem faria 03/04 virar duas datas diferentes conforme o
 * e-mail. Datas ambiguas erradas em conta a pagar sao caras.
 */
export function findDates(texto: string, hoje = new Date()): DateFound[] {
  const achados: DateFound[] = [];

  const registrar = (data: Date | null, bruto: string, index: number) => {
    if (!data) return;
    const antes = texto.slice(Math.max(0, index - 45), index);
    achados.push({ date: data, raw: bruto.trim(), labeled: ROTULO_DE_VENCIMENTO.test(antes) });
  };

  for (const m of texto.matchAll(DATA_NUMERICA)) {
    const [bruto, dia, mes, ano] = m;
    if (!dia || !mes) continue;
    registrar(emData(ano4(ano, hoje), Number(mes) - 1, Number(dia)), bruto, m.index ?? 0);
  }

  for (const m of texto.matchAll(DATA_POR_EXTENSO)) {
    const [bruto, dia, mes, ano] = m;
    if (!dia || !mes) continue;
    const indice = MESES[mes.toLowerCase()];
    if (indice === undefined) continue;
    registrar(emData(ano4(ano, hoje), indice, Number(dia)), bruto, m.index ?? 0);
  }

  return achados;
}

/**
 * Escolhe o vencimento mais provavel: prefere data rotulada; entre
 * rotuladas, a mais proxima no futuro.
 *
 * Devolve `null` quando nada e rotulado — um e-mail cheio de datas soltas
 * nao tem vencimento identificado, e chutar a primeira delas produziria um
 * painel confiante e errado.
 */
export function pickDueDate(texto: string, hoje = new Date()): DateFound | null {
  const rotuladas = findDates(texto, hoje).filter((d) => d.labeled);
  if (rotuladas.length === 0) return null;

  const futuras = rotuladas.filter((d) => d.date.getTime() >= hoje.getTime());
  const candidatas = futuras.length > 0 ? futuras : rotuladas;

  return (
    [...candidatas].sort(
      (a, b) => Math.abs(a.date.getTime() - hoje.getTime()) - Math.abs(b.date.getTime() - hoje.getTime()),
    )[0] ?? null
  );
}

/** Escolhe o valor mais provavel: o maior entre os rotulados. */
export function pickAmount(texto: string): AmountFound | null {
  const rotulados = findAmounts(texto).filter((a) => a.labeled);
  if (rotulados.length === 0) return null;
  // O maior, e nao o primeiro: fatura costuma listar itens e depois o
  // total, e o total e o que interessa para contas a pagar.
  return [...rotulados].sort((a, b) => b.cents - a.cents)[0] ?? null;
}
