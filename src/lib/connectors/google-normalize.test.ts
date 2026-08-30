import { describe, expect, it } from 'vitest';
import {
  decodeMailPageToken,
  encodeMailPageToken,
  extractDisplayName,
  extractEmail,
  labelRole,
  normalizeGmailMessage,
  normalizeGoogleEvent,
  parseCalendarCursor,
  parseEventWindow,
  serializeCalendarCursor,
  splitAddressList,
  type GmailMessageResource,
  type GoogleEventResource,
} from './google-normalize';

describe('labelRole', () => {
  it('mapeia os labels de sistema e trata o resto como pasta do usuario', () => {
    expect(labelRole('INBOX')).toBe('INBOX');
    expect(labelRole('SENT')).toBe('SENT');
    expect(labelRole('TRASH')).toBe('TRASH');
    expect(labelRole('SPAM')).toBe('SPAM');
    expect(labelRole('Label_123')).toBe('CUSTOM');
  });
});

describe('extractEmail / extractDisplayName', () => {
  it('separa nome e endereco de um cabecalho composto', () => {
    expect(extractEmail('Camila Duarte <camila@parceiro.com>')).toBe('camila@parceiro.com');
    expect(extractDisplayName('Camila Duarte <camila@parceiro.com>')).toBe('Camila Duarte');
  });

  it('normaliza um endereco puro e nao inventa nome', () => {
    expect(extractEmail('Camila@Parceiro.com')).toBe('camila@parceiro.com');
    expect(extractDisplayName('camila@parceiro.com')).toBeUndefined();
  });

  it('remove aspas do nome de exibicao', () => {
    expect(extractDisplayName('"Silva, Joao" <joao@x.com>')).toBe('Silva, Joao');
  });

  it('devolve undefined para entrada sem @ ou vazia', () => {
    expect(extractEmail('nao e email')).toBeUndefined();
    expect(extractEmail(undefined)).toBeUndefined();
  });
});

describe('splitAddressList', () => {
  it('separa varios enderecos por virgula', () => {
    expect(splitAddressList('ana@x.com, Bruno <bruno@y.com>')).toEqual([
      'ana@x.com',
      'bruno@y.com',
    ]);
  });

  it('nao quebra um nome com virgula dentro de aspas', () => {
    // "Silva, Joao" <joao@x.com>, ana@y.com sao DOIS enderecos, nao tres.
    expect(splitAddressList('"Silva, Joao" <joao@x.com>, ana@y.com')).toEqual([
      'joao@x.com',
      'ana@y.com',
    ]);
  });

  it('lida com lista vazia', () => {
    expect(splitAddressList(undefined)).toEqual([]);
    expect(splitAddressList('')).toEqual([]);
  });
});

describe('normalizeGmailMessage', () => {
  function mensagem(over: Partial<GmailMessageResource> = {}): GmailMessageResource {
    return {
      id: 'msg1',
      threadId: 'thread1',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'trecho',
      internalDate: String(new Date('2026-08-30T10:00:00Z').getTime()),
      payload: {
        headers: [
          { name: 'Message-ID', value: '<abc@parceiro.com>' },
          { name: 'Subject', value: 'Assunto' },
          { name: 'From', value: 'Camila <camila@parceiro.com>' },
          { name: 'To', value: 'eu@gmail.com' },
        ],
      },
      ...over,
    };
  }

  it('extrai os campos principais', () => {
    const normalizado = normalizeGmailMessage(mensagem());
    expect(normalizado.providerId).toBe('msg1');
    expect(normalizado.rfcMessageId).toBe('<abc@parceiro.com>');
    expect(normalizado.subject).toBe('Assunto');
    expect(normalizado.fromEmail).toBe('camila@parceiro.com');
    expect(normalizado.fromName).toBe('Camila');
    expect(normalizado.toEmails).toEqual(['eu@gmail.com']);
    expect(normalizado.mailboxProviderId).toBe('INBOX');
  });

  it('usa internalDate, nao o cabecalho Date que o remetente controla', () => {
    const normalizado = normalizeGmailMessage(
      mensagem({
        internalDate: String(new Date('2026-08-30T10:00:00Z').getTime()),
        payload: {
          headers: [{ name: 'Date', value: 'Mon, 01 Jan 2001 00:00:00 +0000' }],
        },
      }),
    );
    expect(normalizado.receivedAt.toISOString()).toBe('2026-08-30T10:00:00.000Z');
  });

  it('deriva isRead e isFlagged dos labels', () => {
    expect(normalizeGmailMessage(mensagem({ labelIds: ['INBOX', 'UNREAD'] })).isRead).toBe(false);
    expect(normalizeGmailMessage(mensagem({ labelIds: ['INBOX'] })).isRead).toBe(true);
    expect(normalizeGmailMessage(mensagem({ labelIds: ['INBOX', 'STARRED'] })).isFlagged).toBe(
      true,
    );
  });

  it('prioriza INBOX como caixa canonica mesmo com outros labels', () => {
    const normalizado = normalizeGmailMessage(
      mensagem({ labelIds: ['Label_custom', 'INBOX', 'IMPORTANT'] }),
    );
    expect(normalizado.mailboxProviderId).toBe('INBOX');
  });
});

describe('encodeMailPageToken / decodeMailPageToken', () => {
  it('faz o ciclo completo', () => {
    const estado = { listPageToken: 'abc', historyId: '12345' };
    expect(decodeMailPageToken(encodeMailPageToken(estado))).toEqual(estado);
  });

  it('devolve undefined para token ausente ou corrompido', () => {
    expect(decodeMailPageToken(undefined)).toBeUndefined();
    expect(decodeMailPageToken('lixo-invalido')).toBeUndefined();
  });
});

describe('parseEventWindow', () => {
  it('trata evento com horario normalmente', () => {
    const janela = parseEventWindow({
      id: 'e1',
      start: { dateTime: '2026-08-30T13:00:00-03:00' },
      end: { dateTime: '2026-08-30T14:00:00-03:00' },
    });
    expect(janela?.isAllDay).toBe(false);
  });

  it('trata o fim de um evento de dia inteiro como exclusivo', () => {
    // Evento de 1 dia: end.date e o dia SEGUINTE no Google. Sem tratar isso,
    // o evento apareceria com 1 dia a mais na agenda.
    const janela = parseEventWindow({
      id: 'e2',
      start: { date: '2026-08-30' },
      end: { date: '2026-08-31' },
    });
    expect(janela?.isAllDay).toBe(true);
    expect(janela?.startsAt.getDate()).toBe(30);
    expect(janela?.endsAt.getDate()).toBe(31);
  });

  it('preenche o fim quando ausente, avancando um dia para dia inteiro', () => {
    const janela = parseEventWindow({ id: 'e3', start: { date: '2026-08-30' } });
    expect(janela?.endsAt.getDate()).toBe(31);
  });

  it('devolve null quando nao ha horario utilizavel', () => {
    expect(parseEventWindow({ id: 'e4' })).toBeNull();
  });
});

describe('normalizeGoogleEvent', () => {
  function evento(over: Partial<GoogleEventResource> = {}): GoogleEventResource {
    return {
      id: 'evt1',
      iCalUID: 'evt1@google.com',
      summary: 'Reuniao',
      status: 'confirmed',
      organizer: { email: 'organizador@empresa.com' },
      start: { dateTime: '2026-08-30T13:00:00-03:00' },
      end: { dateTime: '2026-08-30T14:00:00-03:00' },
      attendees: [{ email: 'eu@gmail.com', responseStatus: 'accepted', self: true }],
      ...over,
    };
  }

  it('normaliza os campos principais', () => {
    const normalizado = normalizeGoogleEvent(evento(), 'primary', 'eu@gmail.com');
    expect(normalizado?.title).toBe('Reuniao');
    expect(normalizado?.status).toBe('CONFIRMED');
    expect(normalizado?.responseStatus).toBe('ACCEPTED');
  });

  it('marca como ORGANIZER quando a conta e quem organiza', () => {
    // Sem isso, todo evento proprio apareceria como "aguardando resposta".
    const normalizado = normalizeGoogleEvent(
      evento({ organizer: { email: 'eu@gmail.com', self: true }, attendees: [] }),
      'primary',
      'eu@gmail.com',
    );
    expect(normalizado?.responseStatus).toBe('ORGANIZER');
  });

  it('usa hangoutLink como fallback de conferenceUrl', () => {
    const normalizado = normalizeGoogleEvent(
      evento({ hangoutLink: 'https://meet.google.com/abc' }),
      'primary',
      'eu@gmail.com',
    );
    expect(normalizado?.conferenceUrl).toBe('https://meet.google.com/abc');
  });

  it('devolve null para evento sem janela de tempo utilizavel', () => {
    expect(normalizeGoogleEvent(evento({ start: undefined, end: undefined }), 'p', 'eu@x.com')).toBeNull();
  });
});

describe('cursor de calendario (multi-calendario)', () => {
  it('serializa e recupera um token por calendario', () => {
    const tokens = { primary: 'token-a', 'trabalho@empresa.com': 'token-b' };
    const serializado = serializeCalendarCursor(tokens);
    expect(serializado).toBeDefined();
    expect(parseCalendarCursor(serializado)).toEqual(tokens);
  });

  it('devolve objeto vazio para cursor ausente ou corrompido', () => {
    expect(parseCalendarCursor(undefined)).toEqual({});
    expect(parseCalendarCursor('nao e json')).toEqual({});
    expect(parseCalendarCursor('[1,2,3]')).toEqual({});
  });

  it('nao serializa quando nao ha nenhum token', () => {
    expect(serializeCalendarCursor({})).toBeUndefined();
  });
});
