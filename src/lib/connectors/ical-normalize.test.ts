import { describe, expect, it } from 'vitest';
import { expandIcsToRawEvents } from './ical-normalize';

/**
 * Testes contra o ical.js de verdade (sem mock): e a unica forma de
 * confiar na expansao de recorrencia sem um servidor CalDAV real
 * disponivel nesta sessao (rede deste ambiente bloqueia hosts genericos —
 * ver docs/03-conectores.md). RRULE, EXDATE e RECURRENCE-ID sao regras do
 * RFC 5545, nao do provedor: testar contra a biblioteca real cobre o mesmo
 * comportamento que qualquer servidor CalDAV real exerceria.
 */

const ACCOUNT_EMAIL = 'eu@dominio.com';

function janela(inicioISO: string, fimISO: string) {
  return { since: new Date(inicioISO), until: new Date(fimISO) };
}

function vcalendar(vevents: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//teste//pt-BR', ...vevents, 'END:VCALENDAR'].join(
    '\n',
  );
}

describe('expandIcsToRawEvents — evento simples', () => {
  it('normaliza um evento unico dentro da janela', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:evt-1@dominio.com',
      'SUMMARY:Reuniao',
      'DTSTART:20260830T130000Z',
      'DTEND:20260830T140000Z',
      'ORGANIZER:mailto:organizador@empresa.com',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.title).toBe('Reuniao');
    expect(eventos[0]?.iCalUid).toBe('evt-1@dominio.com');
    expect(eventos[0]?.startsAt.toISOString()).toBe('2026-08-30T13:00:00.000Z');
    expect(eventos[0]?.organizerEmail).toBe('organizador@empresa.com');
  });

  it('descarta evento unico fora da janela', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:evt-2@dominio.com',
      'SUMMARY:Fora da janela',
      'DTSTART:20260101T100000Z',
      'DTEND:20260101T110000Z',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );
    expect(eventos).toHaveLength(0);
  });

  it('devolve lista vazia para ICS malformado, sem lancar excecao', () => {
    expect(() =>
      expandIcsToRawEvents('isto nao e um ICS', 'cal-1', janela('2026-01-01', '2026-12-31'), ACCOUNT_EMAIL),
    ).not.toThrow();
    expect(
      expandIcsToRawEvents('isto nao e um ICS', 'cal-1', janela('2026-01-01', '2026-12-31'), ACCOUNT_EMAIL),
    ).toEqual([]);
  });
});

describe('expandIcsToRawEvents — evento de dia inteiro', () => {
  it('marca isAllDay a partir de DTSTART;VALUE=DATE', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:evt-dia@dominio.com',
      'SUMMARY:Feriado',
      'DTSTART;VALUE=DATE:20260830',
      'DTEND;VALUE=DATE:20260831',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.isAllDay).toBe(true);
  });
});

describe('expandIcsToRawEvents — recorrencia', () => {
  it('expande FREQ=WEEKLY;COUNT=5 em 5 ocorrencias espacadas de 7 dias', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:serie-semanal@dominio.com',
      'SUMMARY:Reuniao semanal',
      'DTSTART:20260803T140000Z',
      'DTEND:20260803T150000Z',
      'RRULE:FREQ=WEEKLY;COUNT=5',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'),
      ACCOUNT_EMAIL,
    );

    expect(eventos).toHaveLength(5);
    const inicios = eventos.map((e) => e.startsAt.toISOString());
    expect(inicios).toEqual([
      '2026-08-03T14:00:00.000Z',
      '2026-08-10T14:00:00.000Z',
      '2026-08-17T14:00:00.000Z',
      '2026-08-24T14:00:00.000Z',
      '2026-08-31T14:00:00.000Z',
    ]);
    // Mesma serie: mesmo iCalUid, providerId distinto por ocorrencia.
    expect(new Set(eventos.map((e) => e.iCalUid)).size).toBe(1);
    expect(new Set(eventos.map((e) => e.providerId)).size).toBe(5);
  });

  it('filtra ocorrencias pela janela, sem devolver a serie inteira', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:serie-mensal@dominio.com',
      'SUMMARY:Mensal',
      'DTSTART:20260101T100000Z',
      'DTEND:20260101T110000Z',
      'RRULE:FREQ=MONTHLY;COUNT=12',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-06-01T00:00:00Z', '2026-08-31T00:00:00Z'),
      ACCOUNT_EMAIL,
    );

    // So junho, julho e agosto caem na janela de 3 meses.
    expect(eventos).toHaveLength(3);
    expect(eventos[0]?.startsAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');
    expect(eventos[2]?.startsAt.toISOString()).toBe('2026-08-01T10:00:00.000Z');
  });

  it('respeita EXDATE, pulando a ocorrencia excluida', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:serie-exdate@dominio.com',
      'SUMMARY:Diaria com excecao',
      'DTSTART:20260810T090000Z',
      'DTEND:20260810T093000Z',
      'RRULE:FREQ=DAILY;COUNT=4',
      'EXDATE:20260811T090000Z',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );

    expect(eventos).toHaveLength(3);
    const dias = eventos.map((e) => e.startsAt.toISOString().slice(0, 10));
    expect(dias).toEqual(['2026-08-10', '2026-08-12', '2026-08-13']);
  });

  it('aplica a substituicao de uma ocorrencia via RECURRENCE-ID (horario movido)', () => {
    // "Arrastei a reuniao de terca para as 16h" — o caso comum que o
    // escopo documentado promete cobrir. Ver ical-normalize.ts.
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:serie-override@dominio.com',
      'SUMMARY:Reuniao semanal',
      'DTSTART:20260804T100000Z',
      'DTEND:20260804T110000Z',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:serie-override@dominio.com',
      'SUMMARY:Reuniao semanal (remarcada)',
      'RECURRENCE-ID:20260811T100000Z',
      'DTSTART:20260811T160000Z',
      'DTEND:20260811T170000Z',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );

    expect(eventos).toHaveLength(3);
    const segunda = eventos.find((e) => e.startsAt.toISOString().startsWith('2026-08-04'));
    const remarcada = eventos.find((e) => e.title === 'Reuniao semanal (remarcada)');

    expect(segunda).toBeDefined();
    expect(remarcada).toBeDefined();
    // A ocorrencia remarcada aparece no horario NOVO, nao no original das 10h.
    expect(remarcada?.startsAt.toISOString()).toBe('2026-08-11T16:00:00.000Z');
    // E nao sobra uma ocorrencia fantasma no horario antigo das 10h no dia 11.
    expect(eventos.some((e) => e.startsAt.toISOString() === '2026-08-11T10:00:00.000Z')).toBe(false);
  });

  it('limita a expansao a um teto de ocorrencias contra RRULE sem fim', () => {
    // FREQ=HOURLY sem COUNT/UNTIL numa janela de anos geraria dezenas de
    // milhares de ocorrencias sem o teto de seguranca.
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:serie-infinita@dominio.com',
      'SUMMARY:De hora em hora',
      'DTSTART:20260101T000000Z',
      'DTEND:20260101T000500Z',
      'RRULE:FREQ=HOURLY',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );

    expect(eventos).toHaveLength(500);
  });

  it('ignora excecao orfa (RECURRENCE-ID sem mestre no mesmo recurso)', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:orfao@dominio.com',
      'SUMMARY:Excecao sem mestre',
      'RECURRENCE-ID:20260810T100000Z',
      'DTSTART:20260810T100000Z',
      'DTEND:20260810T110000Z',
      'END:VEVENT',
    ]);

    const eventos = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );
    expect(eventos).toHaveLength(0);
  });
});

describe('expandIcsToRawEvents — participantes e status', () => {
  it('marca ORGANIZER quando o organizador e a propria conta', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:sou-organizador@dominio.com',
      'SUMMARY:Minha reuniao',
      'DTSTART:20260810T100000Z',
      'DTEND:20260810T110000Z',
      `ORGANIZER:mailto:${ACCOUNT_EMAIL}`,
      'END:VEVENT',
    ]);

    const [evento] = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );
    expect(evento?.responseStatus).toBe('ORGANIZER');
  });

  it('resolve a resposta da propria conta a partir do PARTSTAT do ATTENDEE correspondente', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:convidado@dominio.com',
      'SUMMARY:Convite',
      'DTSTART:20260810T100000Z',
      'DTEND:20260810T110000Z',
      'ORGANIZER:mailto:organizador@empresa.com',
      `ATTENDEE;PARTSTAT=DECLINED;CN=Eu:mailto:${ACCOUNT_EMAIL}`,
      'ATTENDEE;PARTSTAT=ACCEPTED:mailto:outra@empresa.com',
      'END:VEVENT',
    ]);

    const [evento] = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );
    expect(evento?.responseStatus).toBe('DECLINED');
    expect(evento?.attendees).toHaveLength(2);
  });

  it('usa NEEDS_ACTION quando a conta nao esta entre os participantes', () => {
    const ics = vcalendar([
      'BEGIN:VEVENT',
      'UID:sem-mim@dominio.com',
      'SUMMARY:Nao estou nessa',
      'DTSTART:20260810T100000Z',
      'DTEND:20260810T110000Z',
      'ORGANIZER:mailto:organizador@empresa.com',
      'ATTENDEE:mailto:outra@empresa.com',
      'END:VEVENT',
    ]);

    const [evento] = expandIcsToRawEvents(
      ics,
      'cal-1',
      janela('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ACCOUNT_EMAIL,
    );
    expect(evento?.responseStatus).toBe('NEEDS_ACTION');
  });
});
