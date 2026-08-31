import { findConflicts, findFocusWindows, type Conflict, type ConflictCandidate } from '@/core/metrics/conflicts';
import { buildTimeline, type TimelineEntry } from '@/core/metrics/control-tower';

/**
 * Agenda unificada por semana. Ver docs/05-torre-de-controle.md
 *
 * O nucleo da unificacao (deduplicacao por iCalUID, deteccao de conflito
 * entre contas, janelas livres) ja existia e e usado aqui sem mudanca — o
 * que faltava era a tela alem de "hoje".
 *
 * Funcoes puras: recebem os eventos ja carregados e organizam a semana.
 */

const DIA_MS = 86_400_000;

/**
 * Limites da semana que contem `referencia`, comecando na SEGUNDA.
 *
 * Segunda e nao domingo porque a semana util e o que voce olha para
 * decidir agenda de trabalho — e porque as seis caixas sao de negocios.
 */
export function weekBounds(referencia = new Date()): { start: Date; end: Date } {
  const start = new Date(referencia);
  start.setHours(0, 0, 0, 0);
  // getDay(): 0 = domingo. Segunda vira offset 0, domingo vira 6.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export function shiftWeeks(referencia: Date, semanas: number): Date {
  const nova = new Date(referencia);
  nova.setDate(nova.getDate() + semanas * 7);
  return nova;
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

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
  const { workStartHour = 9, workEndHour = 18, now = new Date() } = options;
  const dias: AgendaDay[] = [];

  for (let i = 0; i < 7; i += 1) {
    const diaInicio = new Date(weekStart);
    diaInicio.setDate(diaInicio.getDate() + i);
    diaInicio.setHours(0, 0, 0, 0);
    const diaFim = new Date(diaInicio.getTime() + DIA_MS);

    const doDia = eventos.filter((evento) =>
      overlapsDay(evento.startsAt, evento.endsAt, diaInicio, diaFim),
    );

    // A deduplicacao acontece DENTRO do dia: o mesmo compromisso visto de
    // tres contas vira uma linha com tres bolinhas.
    const colapsados = buildTimeline(doDia, colorByConnection);

    const expedienteInicio = new Date(diaInicio);
    expedienteInicio.setHours(workStartHour, 0, 0, 0);
    const expedienteFim = new Date(diaInicio);
    expedienteFim.setHours(workEndHour, 0, 0, 0);

    dias.push({
      date: diaInicio,
      isToday: sameDay(diaInicio, now),
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
