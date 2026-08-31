import { findConflicts, findFocusWindows, type Conflict, type ConflictCandidate } from '@/core/metrics/conflicts';
import { buildTimeline, type TimelineEntry } from '@/core/metrics/control-tower';
import {
  addDaysInZone,
  DEFAULT_TIMEZONE,
  isSameDayInZone,
  startOfDayInZone,
  zonedParts,
  zonedTimeToUtc,
  zonedWeekday,
} from '@/core/time/zone';

/**
 * Agenda unificada por semana. Ver docs/05-torre-de-controle.md
 *
 * O nucleo da unificacao (deduplicacao por iCalUID, deteccao de conflito
 * entre contas, janelas livres) ja existia e e usado aqui sem mudanca — o
 * que faltava era a tela alem de "hoje".
 *
 * Funcoes puras: recebem os eventos ja carregados e organizam a semana.
 */

/**
 * Limites da semana que contem `referencia`, comecando na SEGUNDA.
 *
 * Segunda e nao domingo porque a semana util e o que voce olha para
 * decidir agenda de trabalho — e porque as seis caixas sao de negocios.
 *
 * TUDO calculado no fuso do usuario, nunca no do servidor: a pagina e
 * renderizada no servidor, e um servidor em UTC colocaria no dia seguinte
 * todo compromisso que acontece depois das 21:00 em Sao Paulo.
 */
export function weekBounds(
  referencia = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): { start: Date; end: Date } {
  const meiaNoite = startOfDayInZone(referencia, timeZone);
  // 0 = domingo. Segunda vira offset 0, domingo vira 6.
  const offset = (zonedWeekday(meiaNoite, timeZone) + 6) % 7;

  const start = startOfDayInZone(addDaysInZone(meiaNoite, timeZone, -offset), timeZone);
  const end = startOfDayInZone(addDaysInZone(start, timeZone, 7), timeZone);
  return { start, end };
}

export function shiftWeeks(referencia: Date, semanas: number, timeZone = DEFAULT_TIMEZONE): Date {
  return addDaysInZone(referencia, timeZone, semanas * 7);
}

export interface AgendaDay {
  date: Date;
  isToday: boolean;
  /** Compromissos ja colapsados: uma linha por reuniao, nao por copia. */
  entries: TimelineEntry[];
  /** Compromissos de dia inteiro, separados: nao ocupam horario. */
  allDay: TimelineEntry[];
  /** Conflitos DENTRO deste dia. */
  conflicts: Conflict[];
  /** Buracos de 90min+ no expediente. */
  freeWindows: { start: Date; end: Date; minutes: number }[];
}

/**
 * Um evento pertence a este dia?
 *
 * Sobreposicao, e nao "comeca neste dia": uma viagem de terca a quinta
 * precisa aparecer nos tres dias. Mostrar so no dia de inicio faria a
 * quarta-feira parecer livre.
 */
function overlapsDay(inicio: Date, fim: Date, diaInicio: Date, diaFim: Date): boolean {
  return inicio.getTime() < diaFim.getTime() && fim.getTime() > diaInicio.getTime();
}

export interface BuildWeekOptions {
  /** Inicio do expediente, para as janelas livres. */
  workStartHour?: number;
  workEndHour?: number;
  now?: Date;
  /** Fuso do usuario. Sem isto, o fuso do servidor manda — e ele esta errado. */
  timeZone?: string;
}

/**
 * Monta os sete dias da semana.
 *
 * Dias vazios continuam na lista: uma semana com buraco no meio nao pode
 * parecer uma semana de cinco dias.
 */
export function buildWeek(
  eventos: ConflictCandidate[],
  colorByConnection: Map<string, string>,
  weekStart: Date,
  options: BuildWeekOptions = {},
): AgendaDay[] {
  const {
    workStartHour = 9,
    workEndHour = 18,
    now = new Date(),
    timeZone = DEFAULT_TIMEZONE,
  } = options;
  const dias: AgendaDay[] = [];

  for (let i = 0; i < 7; i += 1) {
    const diaInicio = startOfDayInZone(addDaysInZone(weekStart, timeZone, i), timeZone);
    const diaFim = startOfDayInZone(addDaysInZone(diaInicio, timeZone, 1), timeZone);

    const doDia = eventos.filter((evento) =>
      overlapsDay(evento.startsAt, evento.endsAt, diaInicio, diaFim),
    );

    // A deduplicacao acontece DENTRO do dia: o mesmo compromisso visto de
    // tres contas vira uma linha com tres bolinhas.
    const colapsados = buildTimeline(doDia, colorByConnection);

    // O expediente tambem e hora de PAREDE do usuario: "09:00" em Sao Paulo,
    // nao 09:00 UTC.
    const p = zonedParts(diaInicio, timeZone);
    const expedienteInicio = zonedTimeToUtc(timeZone, p.year, p.month, p.day, workStartHour);
    const expedienteFim = zonedTimeToUtc(timeZone, p.year, p.month, p.day, workEndHour);

    dias.push({
      date: diaInicio,
      isToday: isSameDayInZone(diaInicio, now, timeZone),
      entries: colapsados.filter((e) => !e.isAllDay),
      allDay: colapsados.filter((e) => e.isAllDay),
      // Conflito e calculado sobre as COPIAS, nao sobre as linhas
      // colapsadas: e a comparacao entre contas diferentes que interessa.
      conflicts: findConflicts(doDia),
      freeWindows: findFocusWindows(doDia, expedienteInicio, expedienteFim),
    });
  }

  return dias;
}

export interface WeekSummary {
  /** Compromissos distintos na semana (ja deduplicados). */
  total: number;
  /** Conflitos entre contas diferentes — o que nenhuma agenda sozinha mostra. */
  crossAccountConflicts: number;
  /** Horas livres no expediente, somando os dias uteis. */
  freeHours: number;
  /** Quantas copias foram colapsadas: a prova de que a unificacao serve. */
  collapsed: number;
}

export function summarizeWeek(dias: AgendaDay[], eventos: ConflictCandidate[]): WeekSummary {
  const chavesDistintas = new Set<string>();
  for (const dia of dias) {
    for (const entrada of [...dia.entries, ...dia.allDay]) chavesDistintas.add(entrada.id);
  }

  const conflitos = new Set<string>();
  for (const dia of dias) {
    for (const conflito of dia.conflicts) {
      if (conflito.crossAccount) conflitos.add([conflito.a.id, conflito.b.id].sort().join(':'));
    }
  }

  const minutosLivres = dias.reduce(
    (soma, dia) => soma + dia.freeWindows.reduce((s, janela) => s + janela.minutes, 0),
    0,
  );

  // Copias colapsadas = quantas linhas a unificacao poupou de voce.
  const copiasNaoCanceladas = eventos.filter((e) => e.status !== 'CANCELLED').length;

  return {
    total: chavesDistintas.size,
    crossAccountConflicts: conflitos.size,
    freeHours: Math.round(minutosLivres / 60),
    collapsed: Math.max(0, copiasNaoCanceladas - chavesDistintas.size),
  };
}

// ---------------------------------------------------------------------------
// Visao de mes
// ---------------------------------------------------------------------------

/**
 * Limites do MES que contem `referencia`, expandidos ate cobrir semanas
 * inteiras (segunda a domingo).
 *
 * Expandir e o que faz a grade do mes ficar retangular: sem isso, a
 * primeira e a ultima linha teriam buracos, e um compromisso do dia 31 do
 * mes anterior sumiria da visao mesmo estando na mesma semana.
 */
export function monthGridBounds(
  referencia = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): { start: Date; end: Date; monthStart: Date } {
  const p = zonedParts(referencia, timeZone);
  const monthStart = zonedTimeToUtc(timeZone, p.year, p.month, 1);

  const start = weekBounds(monthStart, timeZone).start;
  // Primeiro dia do mes seguinte, e dali ate o fim daquela semana.
  const proximoMes = zonedTimeToUtc(timeZone, p.year, p.month + 1, 1);
  const ultimoDia = startOfDayInZone(addDaysInZone(proximoMes, timeZone, -1), timeZone);
  const end = weekBounds(ultimoDia, timeZone).end;

  return { start, end, monthStart };
}

export interface MonthDay {
  date: Date;
  isToday: boolean;
  /** Pertence ao mes que estamos olhando, ou e sobra de semana? */
  inMonth: boolean;
  entries: TimelineEntry[];
  allDay: TimelineEntry[];
  hasCrossAccountConflict: boolean;
}

/**
 * Monta a grade do mes.
 *
 * Reaproveita `buildWeek` semana a semana em vez de reimplementar a
 * agregacao: a deduplicacao, o conflito e a pertinencia ao dia precisam se
 * comportar igual nas duas telas, e duas implementacoes divergiriam.
 */
export function buildMonth(
  eventos: ConflictCandidate[],
  colorByConnection: Map<string, string>,
  referencia = new Date(),
  options: BuildWeekOptions = {},
): { days: MonthDay[]; monthStart: Date } {
  const timeZone = options.timeZone ?? DEFAULT_TIMEZONE;
  const { start, end, monthStart } = monthGridBounds(referencia, timeZone);
  const mesAlvo = zonedParts(monthStart, timeZone).month;

  const days: MonthDay[] = [];
  let cursor = start;

  while (cursor.getTime() < end.getTime()) {
    for (const dia of buildWeek(eventos, colorByConnection, cursor, options)) {
      days.push({
        date: dia.date,
        isToday: dia.isToday,
        inMonth: zonedParts(dia.date, timeZone).month === mesAlvo,
        entries: dia.entries,
        allDay: dia.allDay,
        hasCrossAccountConflict: dia.conflicts.some((c) => c.crossAccount),
      });
    }
    cursor = startOfDayInZone(addDaysInZone(cursor, timeZone, 7), timeZone);
  }

  return { days, monthStart };
}

export function shiftMonths(referencia: Date, meses: number, timeZone = DEFAULT_TIMEZONE): Date {
  const p = zonedParts(referencia, timeZone);
  // Dia 1 para nao cair no bug classico de 31 de janeiro + 1 mes.
  return zonedTimeToUtc(timeZone, p.year, p.month + meses, 1, 12);
}
