/**
 * Datas no fuso do USUARIO, nao no do servidor.
 *
 * Bug real encontrado na agenda: as paginas sao renderizadas no servidor, e
 * `toLocaleTimeString` sem `timeZone` usa o fuso do PROCESSO. Um servidor em
 * UTC mostrava 10:00 para um compromisso que, em Sao Paulo, e 07:00 — e,
 * pior, colocava no dia errado tudo que acontece antes das 03:00.
 *
 * Num app de calendario isso nao e detalhe de formatacao: e a diferenca
 * entre a reuniao aparecer no dia certo ou no dia seguinte.
 *
 * Sem dependencia externa: `Intl` ja sabe converter, so precisa ser usado.
 */

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const cacheDeFormatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(timeZone: string): Intl.DateTimeFormat {
  const existente = cacheDeFormatadores.get(timeZone);
  if (existente) return existente;

  // `en-CA` porque produz ano-mes-dia, que e trivial de ler de volta.
  const novo = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  cacheDeFormatadores.set(timeZone, novo);
  return novo;
}

/** Os componentes de data/hora de um instante, vistos naquele fuso. */
export function zonedParts(instante: Date, timeZone: string): ZonedParts {
  const partes = formatador(timeZone).formatToParts(instante);
  const pegar = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value ?? 0);

  return {
    year: pegar('year'),
    month: pegar('month'),
    day: pegar('day'),
    // `hour12: false` pode devolver 24 para meia-noite em alguns runtimes.
    hour: pegar('hour') % 24,
    minute: pegar('minute'),
  };
}

/** Deslocamento do fuso, em ms, no instante dado (positivo a leste). */
export function zoneOffsetMs(instante: Date, timeZone: string): number {
  const p = zonedParts(instante, timeZone);
  const comoSeFosseUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Zera segundos e ms dos dois lados para a subtracao dar o offset limpo.
  const semSegundos = Math.floor(instante.getTime() / 60_000) * 60_000;
  return comoSeFosseUtc - semSegundos;
}

/**
 * O instante UTC correspondente a uma hora de parede naquele fuso.
 *
 * O ajuste em duas passadas existe por causa do horario de verao: o
 * deslocamento usado no primeiro palpite pode ser o do outro lado da
 * virada. O Brasil nao tem mais DST, mas o codigo nao pode assumir isso —
 * uma das caixas pode ser de fora.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  const alvo = Date.UTC(year, month - 1, day, hour, minute);
  const palpite = new Date(alvo - zoneOffsetMs(new Date(alvo), timeZone));
  const corrigido = new Date(alvo - zoneOffsetMs(palpite, timeZone));
  return corrigido;
}

/** Meia-noite, naquele fuso, do dia que contem o instante. */
export function startOfDayInZone(instante: Date, timeZone: string): Date {
  const p = zonedParts(instante, timeZone);
  return zonedTimeToUtc(timeZone, p.year, p.month, p.day, 0, 0);
}

/** Soma dias respeitando o fuso (e a virada de horario de verao). */
export function addDaysInZone(instante: Date, timeZone: string, dias: number): Date {
  const p = zonedParts(instante, timeZone);
  return zonedTimeToUtc(timeZone, p.year, p.month, p.day + dias, p.hour, p.minute);
}

/**
 * Dia da semana naquele fuso. 0 = domingo, como `getDay()`.
 *
 * Nao da para usar `getDay()` direto: ele responde no fuso do processo, que
 * e exatamente a fonte do bug.
 */
export function zonedWeekday(instante: Date, timeZone: string): number {
  const p = zonedParts(instante, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Dois instantes caem no mesmo dia daquele fuso? */
export function isSameDayInZone(a: Date, b: Date, timeZone: string): boolean {
  const pa = zonedParts(a, timeZone);
  const pb = zonedParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/**
 * Formata sempre com `timeZone` explicito.
 *
 * Existe para que nenhuma tela volte a chamar `toLocaleString` sem fuso: o
 * padrao silencioso e o do servidor, e ele esta errado.
 */
export function formatInZone(
  instante: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale = 'pt-BR',
): string {
  return instante.toLocaleString(locale, { ...options, timeZone });
}

export function formatTime(instante: Date, timeZone: string): string {
  return formatInZone(instante, timeZone, { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(instante: Date, timeZone: string): string {
  return formatInZone(instante, timeZone, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `YYYY-MM-DD` naquele fuso, para links e parametros de URL. */
export function isoDateInZone(instante: Date, timeZone: string): string {
  const p = zonedParts(instante, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Rotulo curto do fuso, para a tela poder dizer em que fuso esta mostrando. */
export function zoneLabel(instante: Date, timeZone: string): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(instante);
  return partes.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}
