/**
 * Observabilidade do sync. Ver docs/13-saude.md
 *
 * Isto é agregação pura: recebe corridas já lidas do banco e devolve
 * números. Sem Prisma aqui — o que decide se a tela mente ou não é a
 * aritmética, e aritmética se testa sem banco.
 *
 * Três honestidades embutidas, cada uma respondendo a uma forma conhecida
 * de este painel mentir:
 *
 *  1. **Corrida órfã.** Uma corrida é aberta antes e fechada depois, até em
 *     falha. Se ela ficou aberta, o processo MORREU no meio — foi o que
 *     aconteceu de verdade quando a função estourou o tempo da Vercel. Uma
 *     média que ignora essas corridas mostra "tudo verde" no dia em que
 *     nada terminou.
 *  2. **Percentil com n pequeno.** Três syncs por dia por conta dão poucas
 *     dezenas de corridas por provedor por semana. Um p95 sobre n=6 é
 *     ruído com cara de medida, então abaixo de um mínimo ele não é
 *     mostrado.
 *  3. **Duração é nossa, não do provedor.** O relógio cobre buscar E
 *     gravar. Chamar isso de "latência do Google" seria culpar o provedor
 *     pelo nosso `persist`.
 */

export interface CorridaBruta {
  connectionId: string;
  provider: string;
  conta: string;
  resource: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: string | null;
  itens: number;
  errorMessage: string | null;
}

/**
 * Depois disto, uma corrida aberta não está rodando: morreu.
 *
 * O teto de execução de uma função na Vercel é 60s, e o ciclo se dá 45s
 * para responder. Dez minutos é folga de sobra para não confundir uma
 * corrida em andamento com um cadáver.
 */
export const LIMITE_ORFA_MS = 10 * 60 * 1000;

/** Abaixo disto, p95 é ruído com cara de medida. */
export const MINIMO_PARA_P95 = 20;

/** Corrida que ficou aberta tempo demais: o processo morreu no meio. */
export function ehOrfa(corrida: CorridaBruta, agora: Date, limiteMs = LIMITE_ORFA_MS): boolean {
  if (corrida.finishedAt) return false;
  return agora.getTime() - corrida.startedAt.getTime() > limiteMs;
}

/** Ainda aberta e dentro do limite: provavelmente rodando agora. */
export function emAndamento(corrida: CorridaBruta, agora: Date, limiteMs = LIMITE_ORFA_MS): boolean {
  return !corrida.finishedAt && !ehOrfa(corrida, agora, limiteMs);
}

export function duracaoMs(corrida: CorridaBruta): number | undefined {
  if (!corrida.finishedAt) return undefined;
  const ms = corrida.finishedAt.getTime() - corrida.startedAt.getTime();
  // Relógio para trás entre duas gravações: descartar é mais honesto que
  // reportar duração negativa.
  return ms >= 0 ? ms : undefined;
}

/**
 * Percentil por posto mais próximo (nearest-rank), sem interpolar.
 *
 * Interpolar inventa um valor que nenhuma corrida teve. Com dezenas de
 * amostras, devolver uma medida real é mais defensável que uma média entre
 * duas.
 */
export function percentil(valores: number[], p: number): number | undefined {
  if (valores.length === 0) return undefined;
  const ordenados = [...valores].sort((a, b) => a - b);
  const posto = Math.ceil((p / 100) * ordenados.length);
  return ordenados[Math.min(Math.max(posto, 1), ordenados.length) - 1];
}

export interface Resumo {
  /** Identificador do grupo (provedor, ou conexão+recurso). */
  chave: string;
  rotulo: string;
  total: number;
  sucesso: number;
  parcial: number;
  falha: number;
  /** Abertas há tempo demais: o processo morreu no meio. */
  orfas: number;
  /** Abertas e recentes: provavelmente rodando agora. */
  rodando: number;
  itens: number;
  p50Ms?: number;
  /** Só quando há amostra suficiente; senão `undefined`, e a tela diz por quê. */
  p95Ms?: number;
  amostraDuracao: number;
  ultimoErro?: { quando: Date; mensagem: string };
}

function resumirGrupo(chave: string, rotulo: string, corridas: CorridaBruta[], agora: Date): Resumo {
  const duracoes = corridas.map(duracaoMs).filter((d): d is number => d !== undefined);

  // O erro mais recente, não o primeiro encontrado: quem abre esta tela
  // quer saber o que está quebrado agora.
  const comErro = corridas
    .filter((c) => c.errorMessage)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

  return {
    chave,
    rotulo,
    total: corridas.length,
    sucesso: corridas.filter((c) => c.outcome === 'SUCCESS').length,
    parcial: corridas.filter((c) => c.outcome === 'PARTIAL').length,
    falha: corridas.filter((c) => c.outcome === 'FAILED').length,
    orfas: corridas.filter((c) => ehOrfa(c, agora)).length,
    rodando: corridas.filter((c) => emAndamento(c, agora)).length,
    itens: corridas.reduce((soma, c) => soma + c.itens, 0),
    p50Ms: percentil(duracoes, 50),
    p95Ms: duracoes.length >= MINIMO_PARA_P95 ? percentil(duracoes, 95) : undefined,
    amostraDuracao: duracoes.length,
    ultimoErro: comErro?.errorMessage
      ? { quando: comErro.startedAt, mensagem: comErro.errorMessage }
      : undefined,
  };
}

function agrupar<T>(itens: T[], chaveDe: (item: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const chave = chaveDe(item);
    const lista = mapa.get(chave);
    if (lista) lista.push(item);
    else mapa.set(chave, [item]);
  }
  return mapa;
}

const PROVEDOR: Record<string, string> = {
  GOOGLE: 'Google',
  MICROSOFT: 'Microsoft',
  APPLE: 'Apple iCloud',
  IMAP_CALDAV: 'IMAP/CalDAV',
};

export function rotuloProvedor(provider: string): string {
  return PROVEDOR[provider] ?? provider;
}

/** Uma linha por provedor. Responde "qual provedor está lento ou quebrado". */
export function resumirPorProvedor(corridas: CorridaBruta[], agora: Date): Resumo[] {
  return [...agrupar(corridas, (c) => c.provider)]
    .map(([provider, lista]) => resumirGrupo(provider, rotuloProvedor(provider), lista, agora))
    .sort((a, b) => b.total - a.total);
}

const RECURSO: Record<string, string> = { MAIL: 'e-mail', CALENDAR: 'agenda', CONTACTS: 'contatos' };

/**
 * Uma linha por conta × recurso — a granularidade em que o problema mora.
 *
 * "O Google está lento" quase nunca é verdade: uma caixa específica está.
 */
export function resumirPorRecurso(corridas: CorridaBruta[], agora: Date): Resumo[] {
  return [...agrupar(corridas, (c) => `${c.connectionId}:${c.resource}`)]
    .map(([chave, lista]) => {
      const um = lista[0]!;
      return resumirGrupo(chave, `${um.conta} · ${RECURSO[um.resource] ?? um.resource}`, lista, agora);
    })
    .sort((a, b) => b.falha + b.orfas - (a.falha + a.orfas) || b.total - a.total);
}

/**
 * Distância máxima entre duas corridas do mesmo ciclo.
 *
 * O ciclo dispara os recursos em sequência dentro da mesma execução; uma
 * volta inteira de seis caixas leva minutos, não horas. Vinte minutos
 * separa "mesma volta" de "volta seguinte" com folga nos dois lados.
 */
export const JANELA_DO_CICLO_MS = 20 * 60 * 1000;

export interface DiaDeCiclos {
  /** `AAAA-MM-DD` em UTC — o mesmo relógio do cron. */
  dia: string;
  ciclos: number;
}

/**
 * Quantas VOLTAS o sync deu por dia — não quantas corridas.
 *
 * É a métrica que responde "o agendamento está rodando?". Contar corridas
 * responderia outra coisa: seis caixas fazem doze corridas por volta, e o
 * número subiria ao conectar uma conta nova sem o cron ter mudado nada.
 */
export function ciclosPorDia(corridas: CorridaBruta[], janelaMs = JANELA_DO_CICLO_MS): DiaDeCiclos[] {
  const inicios = corridas.map((c) => c.startedAt.getTime()).sort((a, b) => a - b);

  const porDia = new Map<string, number>();
  let anterior: number | undefined;

  for (const inicio of inicios) {
    const novaVolta = anterior === undefined || inicio - anterior > janelaMs;
    if (novaVolta) {
      const dia = new Date(inicio).toISOString().slice(0, 10);
      porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
    }
    anterior = inicio;
  }

  return [...porDia].map(([dia, ciclos]) => ({ dia, ciclos })).sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * Voltas esperadas por dia.
 *
 * Amarrado ao `.github/workflows/sincronizar.yml`, que dispara às 10h, 16h
 * e 22h UTC. Se o agendamento mudar lá, este número muda aqui — e é por
 * isso que ele é uma constante nomeada, e não um `3` solto na tela.
 */
export const VOLTAS_ESPERADAS_POR_DIA = 3;

export interface DiaDaSerie extends DiaDeCiclos {
  /**
   * A janela não cobre este dia inteiro, nas duas pontas: hoje ainda está
   * acontecendo, e o primeiro dia começou antes de a janela abrir. Contar
   * "1 de 3" em qualquer um dos dois é acusar de atraso o que só está
   * cortado pela borda.
   */
  parcial: boolean;
  hoje: boolean;
}

const MEIA_NOITE = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * A série completa do período, **com os dias de zero dentro**.
 *
 * `ciclosPorDia` só devolve dias que tiveram alguma corrida — e um gráfico
 * de "voltas por dia" que pula o dia em branco esconde exatamente o que ele
 * existe para mostrar. Preencher o buraco com zero é o ponto.
 */
export function serieDeDias(dias: DiaDeCiclos[], inicio: Date, fim: Date): DiaDaSerie[] {
  const porDia = new Map(dias.map((d) => [d.dia, d.ciclos]));
  const diaFinal = new Date(MEIA_NOITE(fim)).toISOString().slice(0, 10);
  // "7 dias atrás" cai no meio de um dia, e as corridas da madrugada dele
  // ficaram fora da consulta. Só é dia inteiro se a janela abriu à meia-noite.
  const primeiroCortado = inicio.getTime() > MEIA_NOITE(inicio);
  const diaInicial = new Date(MEIA_NOITE(inicio)).toISOString().slice(0, 10);

  const serie: DiaDaSerie[] = [];
  const cursor = new Date(MEIA_NOITE(inicio));

  while (cursor.getTime() <= MEIA_NOITE(fim)) {
    const dia = cursor.toISOString().slice(0, 10);
    serie.push({
      dia,
      ciclos: porDia.get(dia) ?? 0,
      parcial: dia === diaFinal || (primeiroCortado && dia === diaInicial),
      hoje: dia === diaFinal,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return serie;
}

/**
 * Dias INTEIROS sem nenhuma volta, em ordem.
 *
 * Um buraco é o sintoma mais barato de ver e o mais caro de descobrir
 * tarde: o dia em que o agendamento não rodou não aparece em média nenhuma,
 * porque não gerou linha para entrar na média.
 *
 * As duas pontas ficam de fora. Às 00h30 o dia corrente legitimamente ainda
 * não teve volta, e o primeiro dia da janela teve as voltas da madrugada
 * cortadas pela própria janela. Acusar qualquer um dos dois seria alarme
 * falso todo santo dia — o tipo de aviso que ensina a ignorar avisos.
 */
export function diasSemCiclo(dias: DiaDeCiclos[], inicio: Date, fim: Date): string[] {
  return serieDeDias(dias, inicio, fim)
    .filter((d) => d.ciclos === 0 && !d.parcial)
    .map((d) => d.dia);
}

/** Soma dos totais, para o cabeçalho da tela. */
export function totalizar(resumos: Resumo[]): Omit<Resumo, 'chave' | 'rotulo' | 'ultimoErro'> {
  const duracaoAmostra = resumos.reduce((s, r) => s + r.amostraDuracao, 0);
  return {
    total: resumos.reduce((s, r) => s + r.total, 0),
    sucesso: resumos.reduce((s, r) => s + r.sucesso, 0),
    parcial: resumos.reduce((s, r) => s + r.parcial, 0),
    falha: resumos.reduce((s, r) => s + r.falha, 0),
    orfas: resumos.reduce((s, r) => s + r.orfas, 0),
    rodando: resumos.reduce((s, r) => s + r.rodando, 0),
    itens: resumos.reduce((s, r) => s + r.itens, 0),
    amostraDuracao: duracaoAmostra,
  };
}

/** `1234` → `1,2s`. Milissegundo cru numa tela não diz nada a ninguém. */
export function formatarDuracao(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutos = Math.floor(ms / 60_000);
  return `${minutos}min ${Math.round((ms % 60_000) / 1000)}s`;
}
