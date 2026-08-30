import ICAL from 'ical.js';
import type { RawEvent } from './types';

/**
 * Parsing de ICS (iCalendar/RFC 5545) e expansão de recorrência.
 *
 * Diferente do Google (`singleEvents=true`) e do Microsoft Graph
 * (`calendarView`), CalDAV genérico não garante instâncias pré-expandidas: o
 * servidor pode devolver a série (VEVENT mestre com RRULE) crua. Quando o
 * servidor aceita o parâmetro `expand` da query CalDAV, o conector já pede
 * expansão no servidor (ver caldav-client.ts); esta expansão local é o
 * fallback para quando ele não aceita — ou o caminho único para servidores
 * que nunca suportam `expand`.
 *
 * Escopo assumido, documentado em docs/03-conectores.md: RRULE + EXDATE +
 * substituição de ocorrência via RECURRENCE-ID (o caso comum — "arrastei uma
 * reunião de segunda para terça"). Não implementamos RANGE=THISANDFUTURE
 * (edição de uma ocorrência em diante).
 */

/** Teto de ocorrências expandidas por série, contra RRULE sem fim praticável. */
const MAX_OCCURRENCES_PER_SERIES = 500;

const STATUS_MAP: Record<string, RawEvent['status']> = {
  CONFIRMED: 'CONFIRMED',
  TENTATIVE: 'TENTATIVE',
  CANCELLED: 'CANCELLED',
};

const PARTSTAT_MAP: Record<string, RawEvent['responseStatus']> = {
  'NEEDS-ACTION': 'NEEDS_ACTION',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  TENTATIVE: 'TENTATIVE',
};

function limparMailto(valor?: string | null): string | undefined {
  if (!valor) return undefined;
  return valor.replace(/^mailto:/i, '').trim().toLowerCase() || undefined;
}

/** Propriedade CONFERENCE (RFC 7986) ou URL como fallback para link de reunião. */
function conferenceUrlDoEvento(event: ICAL.Event): string | undefined {
  const conference = event.component.getFirstPropertyValue('conference') as string | null;
  if (conference) return conference;
  const url = event.component.getFirstPropertyValue('url') as string | null;
  return url ?? undefined;
}

function attendeesDoEvento(event: ICAL.Event): RawEvent['attendees'] {
  return event.attendees.map((prop) => {
    const email = limparMailto(prop.getFirstValue() as string) ?? '';
    const partstat = (prop.getParameter('partstat') as string | undefined)?.toUpperCase();
    const nome = prop.getParameter('cn') as string | undefined;
    return { email, name: nome, responseStatus: partstat };
  });
}

/**
 * Resposta do PRÓPRIO usuário ao convite: procura, entre os participantes, o
 * que corresponde ao e-mail da conta — igual à estratégia usada para o
 * Google (o Graph resolve isso pronto; CalDAV genérico, como o Google, não).
 */
function responseStatusDoUsuario(event: ICAL.Event, accountEmail: string): RawEvent['responseStatus'] {
  const organizerEmail = limparMailto(event.organizer);
  if (organizerEmail && organizerEmail === accountEmail.toLowerCase()) return 'ORGANIZER';

  const participante = event.attendees.find(
    (prop) => limparMailto(prop.getFirstValue() as string) === accountEmail.toLowerCase(),
  );
  if (!participante) return 'NEEDS_ACTION';

  const partstat = (participante.getParameter('partstat') as string | undefined)?.toUpperCase();
  return (partstat && PARTSTAT_MAP[partstat]) || 'NEEDS_ACTION';
}

function statusDoEvento(event: ICAL.Event): RawEvent['status'] {
  const status = (event.component.getFirstPropertyValue('status') as string | null)?.toUpperCase();
  return (status && STATUS_MAP[status]) || 'CONFIRMED';
}

function paraRawEvent(
  event: ICAL.Event,
  startsAt: Date,
  endsAt: Date,
  calendarProviderId: string,
  providerIdSuffix: string,
  accountEmail: string,
): RawEvent {
  return {
    // Uma serie recorrente gera N ocorrencias; o providerId precisa ser
    // unico por ocorrencia, senao a segunda pisa na primeira no upsert.
    providerId: `${event.uid}${providerIdSuffix}`,
    calendarProviderId,
    iCalUid: event.uid,
    recurringEventId: providerIdSuffix ? event.uid : undefined,
    title: event.summary || undefined,
    description: event.description || undefined,
    location: event.location || undefined,
    startsAt,
    endsAt,
    isAllDay: event.startDate?.isDate ?? false,
    timezone: event.startDate?.zone?.tzid,
    status: statusDoEvento(event),
    responseStatus: responseStatusDoUsuario(event, accountEmail),
    organizerEmail: limparMailto(event.organizer),
    attendees: attendeesDoEvento(event),
    conferenceUrl: conferenceUrlDoEvento(event),
  };
}

export interface IcsExpansionWindow {
  since: Date;
  until: Date;
}

/**
 * Converte o ICS de UM recurso (que pode conter o VEVENT mestre + VEVENTs de
 * excecao com RECURRENCE-ID, todos compartilhando o mesmo UID — e assim que
 * o CalDAV agrupa uma serie modificada num unico .ics) em RawEvent[],
 * expandindo a recorrencia dentro da janela quando o servidor nao ja expandiu.
 */
export function expandIcsToRawEvents(
  icsText: string,
  calendarProviderId: string,
  window: IcsExpansionWindow,
  accountEmail: string,
): RawEvent[] {
  let comp: ICAL.Component;
  try {
    comp = new ICAL.Component(ICAL.parse(icsText));
  } catch {
    // ICS malformado de um provedor excêntrico não pode derrubar o sync
    // inteiro; esse recurso só fica de fora.
    return [];
  }

  const vevents = comp.getAllSubcomponents('vevent');
  if (vevents.length === 0) return [];

  // Agrupa por UID: o mestre (sem RECURRENCE-ID) mais suas exceções viram um
  // ICAL.Event só, que já resolve overrides via getOccurrenceDetails.
  const porUid = new Map<string, { master?: ICAL.Component; exceptions: ICAL.Component[] }>();
  for (const vevent of vevents) {
    const evento = new ICAL.Event(vevent);
    const grupo = porUid.get(evento.uid) ?? { exceptions: [] };
    if (evento.isRecurrenceException()) grupo.exceptions.push(vevent);
    else grupo.master = vevent;
    porUid.set(evento.uid, grupo);
  }

  const resultados: RawEvent[] = [];

  for (const { master, exceptions } of porUid.values()) {
    // Exceção órfã (sem mestre no mesmo recurso) — não há como situá-la numa
    // série; ignorar é mais seguro que inventar uma ocorrência solta.
    if (!master) continue;

    const event = new ICAL.Event(master, { exceptions: exceptions.map((e) => new ICAL.Event(e)) });

    if (!event.isRecurring()) {
      const startsAt = event.startDate.toJSDate();
      const endsAt = event.endDate.toJSDate();
      if (endsAt >= window.since && startsAt <= window.until) {
        resultados.push(paraRawEvent(event, startsAt, endsAt, calendarProviderId, '', accountEmail));
      }
      continue;
    }

    const iterator = event.iterator();
    let proxima: ICAL.Time | null;
    let contagem = 0;

    while (contagem < MAX_OCCURRENCES_PER_SERIES && (proxima = iterator.next())) {
      contagem += 1;
      const inicioBruto = proxima.toJSDate();
      if (inicioBruto > window.until) break;

      const detalhes = event.getOccurrenceDetails(proxima);
      const startsAt = detalhes.startDate.toJSDate();
      const endsAt = detalhes.endDate.toJSDate();
      if (endsAt < window.since) continue;

      resultados.push(
        paraRawEvent(
          detalhes.item,
          startsAt,
          endsAt,
          calendarProviderId,
          `:${detalhes.recurrenceId.toICALString()}`,
          accountEmail,
        ),
      );
    }
  }

  return resultados;
}
