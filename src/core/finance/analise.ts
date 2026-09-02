import { zonedParts } from '@/core/time/zone';
import { chaveDeRegra } from './categorias';

/**
 * Analise do razao (fase 7C): fluxo por mes e por negocio, recorrente x
 * unico, e "torneira vazando". Tudo puro — recebe lancamentos, devolve
 * numeros — e por isso testavel sem banco. Ver docs/10-financeiro.md
 *
 * A honestidade que vale para tudo aqui: sao contas sobre o que FOI
 * importado. Conta que nao entrou no app nao entra na analise, e o app diz
 * isso na tela em vez de fingir completude.
 */

export interface LancamentoAnalise {
  postedAt: Date;
  amountCents: number;
  category: string | null;
  business: string | null;
  normalized: string;
  description: string;
  accountId: string;
  accountLabel: string;
}

/** 'AAAA-MM' no fuso do usuario. */
export function mesDe(instante: Date, timeZone: string): string {
  const p = zonedParts(instante, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export interface MesFluxo {
  mes: string;
  entradas: number;
  saidas: number;
  liquido: number;
}

/** Ultimos N meses, do mais antigo ao mais novo, com zeros onde nao houve nada. */
export function ultimosMeses(agora: Date, timeZone: string, n: number): string[] {
  const p = zonedParts(agora, timeZone);
  const meses: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const total = p.year * 12 + (p.month - 1) - i;
    const ano = Math.floor(total / 12);
    const mes = (total % 12) + 1;
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`);
  }
  return meses;
}

export function fluxoMensal(
  lancamentos: LancamentoAnalise[],
  timeZone: string,
  meses: string[],
): MesFluxo[] {
  const porMes = new Map<string, MesFluxo>(meses.map((m) => [m, { mes: m, entradas: 0, saidas: 0, liquido: 0 }]));
  for (const l of lancamentos) {
    // Transferencia entre contas nao e entrada nem saida do conjunto.
    if (l.category === 'Transferência entre contas') continue;
    const alvo = porMes.get(mesDe(l.postedAt, timeZone));
    if (!alvo) continue;
    if (l.amountCents > 0) alvo.entradas += l.amountCents;
    else alvo.saidas += l.amountCents;
    alvo.liquido = alvo.entradas + alvo.saidas;
  }
  return meses.map((m) => porMes.get(m)!);
}

export interface FluxoPorNegocio {
  negocio: string;
  meses: MesFluxo[];
  totalEntradas: number;
  totalSaidas: number;
}

export function fluxoPorNegocio(
  lancamentos: LancamentoAnalise[],
  timeZone: string,
  meses: string[],
): FluxoPorNegocio[] {
  const grupos = new Map<string, LancamentoAnalise[]>();
  for (const l of lancamentos) {
    const chave = l.business ?? '(sem negócio)';
    const lista = grupos.get(chave) ?? [];
    lista.push(l);
    grupos.set(chave, lista);
  }
  return [...grupos.entries()]
    .map(([negocio, lista]) => {
      const fluxo = fluxoMensal(lista, timeZone, meses);
      return {
        negocio,
        meses: fluxo,
        totalEntradas: fluxo.reduce((s, m) => s + m.entradas, 0),
        totalSaidas: fluxo.reduce((s, m) => s + m.saidas, 0),
      };
    })
    // Uma linha inteira de zeros e ruido: acontece com o grupo que so tem
    // transferencia entre contas, que sai dos totais de proposito.
    .filter((n) => n.totalEntradas !== 0 || n.totalSaidas !== 0)
    .sort((a, b) => Math.abs(b.totalSaidas) + b.totalEntradas - (Math.abs(a.totalSaidas) + a.totalEntradas));
}

export interface CategoriaTotal {
  categoria: string;
  total: number;
  quantidade: number;
}

/** Saidas por categoria, maior primeiro. Sem categoria vira "(sem categoria)". */
export function saidasPorCategoria(lancamentos: LancamentoAnalise[]): CategoriaTotal[] {
  const mapa = new Map<string, CategoriaTotal>();
  for (const l of lancamentos) {
    if (l.amountCents >= 0) continue;
    if (l.category === 'Transferência entre contas') continue;
    const chave = l.category ?? '(sem categoria)';
    const t = mapa.get(chave) ?? { categoria: chave, total: 0, quantidade: 0 };
    t.total += l.amountCents;
    t.quantidade += 1;
    mapa.set(chave, t);
  }
  return [...mapa.values()].sort((a, b) => a.total - b.total);
}

export interface Recorrente {
  chave: string;
  exemplo: string;
  categoria: string | null;
  /** Meses distintos em que apareceu. */
  meses: number;
  /** Mediana dos valores mensais (soma por mes), em centavos. Negativo para saida. */
  mediana: number;
  /** Valor do mes mais recente em que apareceu. */
  ultimo: number;
  ultimoMes: string;
  /** Variacao do ultimo sobre a mediana, em fracao (0.12 = 12% maior em modulo). */
  variacao: number;
  contas: string[];
  negocios: string[];
  /** Saida (true) ou entrada (false). */
  saida: boolean;
}

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[meio]! : Math.round((ordenados[meio - 1]! + ordenados[meio]!) / 2);
}

/**
 * Recorrente = mesma chave em pelo menos `minimoMeses` meses distintos.
 *
 * A chave e a da regra (quem), nao a descricao inteira: "netflix" recorre;
 * "netflix 15/08" nao. Soma por mes antes de comparar, para dois pagamentos
 * no mesmo mes nao parecerem "valor caiu pela metade".
 */
export function recorrentes(
  lancamentos: LancamentoAnalise[],
  timeZone: string,
  minimoMeses = 3,
): Recorrente[] {
  interface Acum {
    porMes: Map<string, number>;
    exemplo: string;
    categoria: string | null;
    contas: Set<string>;
    negocios: Set<string>;
    saida: boolean;
  }
  const grupos = new Map<string, Acum>();

  for (const l of lancamentos) {
    if (l.category === 'Transferência entre contas') continue;
    const chave = chaveDeRegra(l.normalized) ?? l.normalized;
    if (!chave) continue;
    const id = `${l.amountCents < 0 ? 's' : 'e'}:${chave}`;
    const g = grupos.get(id) ?? {
      porMes: new Map(),
      exemplo: l.description,
      categoria: l.category,
      contas: new Set(),
      negocios: new Set(),
      saida: l.amountCents < 0,
    };
    const mes = mesDe(l.postedAt, timeZone);
    g.porMes.set(mes, (g.porMes.get(mes) ?? 0) + l.amountCents);
    g.contas.add(l.accountLabel);
    if (l.business) g.negocios.add(l.business);
    if (l.category && !g.categoria) g.categoria = l.category;
    grupos.set(id, g);
  }

  const saida: Recorrente[] = [];
  for (const [id, g] of grupos) {
    if (g.porMes.size < minimoMeses) continue;
    const mesesOrdenados = [...g.porMes.keys()].sort();
    const valores = mesesOrdenados.map((m) => g.porMes.get(m)!);
    const med = mediana(valores);
    const ultimoMes = mesesOrdenados[mesesOrdenados.length - 1]!;
    const ultimo = g.porMes.get(ultimoMes)!;
    const variacao = med === 0 ? 0 : (Math.abs(ultimo) - Math.abs(med)) / Math.abs(med);
    saida.push({
      chave: id.slice(2),
      exemplo: g.exemplo,
      categoria: g.categoria,
      meses: g.porMes.size,
      mediana: med,
      ultimo,
      ultimoMes,
      variacao: Math.round(variacao * 1000) / 1000,
      contas: [...g.contas],
      negocios: [...g.negocios],
      saida: g.saida,
    });
  }
  return saida.sort((a, b) => Math.abs(b.mediana) - Math.abs(a.mediana));
}

export type TipoTorneira = 'aumentou' | 'duplicado' | 'sem-categoria';

export interface Torneira {
  tipo: TipoTorneira;
  recorrente: Recorrente;
  /** Por que esta aqui, em linguagem de gente. */
  motivo: string;
  /** Quanto custa por mes, em centavos (modulo). Para ordenar pelo que doi. */
  custoMensal: number;
}

/**
 * "Torneira vazando": o que sai todo mes e merece um olhar.
 *
 * - aumentou: o ultimo mes veio mais de 5% acima da mediana. Assinatura que
 *   subiu de preco em silencio.
 * - duplicado: a mesma coisa recorrente em duas contas ou dois negocios.
 *   Servico pago duas vezes, ou pago pelo negocio errado.
 * - sem-categoria: recorre e ninguem sabe o que e. Nao e vazamento por
 *   definicao — e o lugar mais provavel de um estar escondido.
 *
 * So saidas. Entrada que aumentou e boa noticia.
 */
export function torneiras(rec: Recorrente[], limiarAumento = 0.05): Torneira[] {
  const lista: Torneira[] = [];
  for (const r of rec) {
    if (!r.saida) continue;
    const custo = Math.abs(r.mediana);
    if (r.variacao > limiarAumento) {
      lista.push({
        tipo: 'aumentou',
        recorrente: r,
        motivo: `último mês ${Math.round(r.variacao * 100)}% acima do habitual`,
        custoMensal: Math.abs(r.ultimo),
      });
    }
    if (r.contas.length > 1 || r.negocios.length > 1) {
      const onde = r.contas.length > 1 ? `${r.contas.length} contas` : `${r.negocios.length} negócios`;
      lista.push({ tipo: 'duplicado', recorrente: r, motivo: `aparece em ${onde}`, custoMensal: custo });
    }
    if (!r.categoria || r.categoria === 'Outros') {
      lista.push({ tipo: 'sem-categoria', recorrente: r, motivo: 'recorre todo mês e não tem categoria', custoMensal: custo });
    }
  }
  return lista.sort((a, b) => b.custoMensal - a.custoMensal);
}

export interface Previsibilidade {
  /** Media mensal de entradas nos meses com dado, em centavos. */
  mediaEntradas: number;
  /** Quanto disso e recorrente, ponderado pela frequencia. */
  recorrenteEntradas: number;
  /** 0..1 */
  fracaoRecorrente: number;
  mediaSaidas: number;
  recorrenteSaidas: number;
  /** Quantos meses de saida a media de entradas cobre; >1 e folga. */
  cobertura: number;
}

/**
 * Quanto do que entra e previsivel. Para um negocio de palestras, a
 * distincao entre receita recorrente e evento unico e a que importa.
 */
export function previsibilidade(fluxo: MesFluxo[], rec: Recorrente[]): Previsibilidade {
  const comDado = fluxo.filter((m) => m.entradas !== 0 || m.saidas !== 0);
  const n = Math.max(1, comDado.length);
  const mediaEntradas = Math.round(comDado.reduce((s, m) => s + m.entradas, 0) / n);
  const mediaSaidas = Math.round(comDado.reduce((s, m) => s + m.saidas, 0) / n);

  // Ponderado pela FREQUENCIA, e nao a soma das medianas.
  //
  // Somar mediana de coisas que aparecem em numeros diferentes de meses
  // produz um numero maior que a propria media — e a tela mostrava
  // "100% previsivel · R$ 22.000 recorrente de R$ 15.667", que se
  // contradiz na mesma linha. Um cliente que pagou em 3 dos 9 meses
  // contribui com 3/9 da mediana dele para o mes tipico.
  const mensal = (r: Recorrente) => Math.round(r.mediana * (r.meses / n));
  const recorrenteEntradas = rec.filter((r) => !r.saida).reduce((s, r) => s + mensal(r), 0);
  const recorrenteSaidas = rec.filter((r) => r.saida).reduce((s, r) => s + mensal(r), 0);

  return {
    mediaEntradas,
    recorrenteEntradas,
    fracaoRecorrente: mediaEntradas > 0 ? Math.min(1, recorrenteEntradas / mediaEntradas) : 0,
    mediaSaidas,
    recorrenteSaidas,
    cobertura: mediaSaidas < 0 ? Math.round((mediaEntradas / -mediaSaidas) * 100) / 100 : 0,
  };
}
