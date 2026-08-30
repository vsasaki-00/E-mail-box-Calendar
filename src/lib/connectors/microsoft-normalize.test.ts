import { describe, expect, it } from 'vitest';
import {
  folderRole,
  normalizeGraphEvent,
  normalizeGraphMessage,
  parseGraphEventWindow,
  type GraphEventResource,
  type GraphMessageResource,
} from './microsoft-normalize';

describe('folderRole', () => {
  it('mapeia pelo alias bem-conhecido, nao pelo nome de exibicao localizado', () => {
    // O nome de exibicao muda de idioma ("Caixa de Entrada", "Posteingang"),
    // o alias nao. Mapear pelo displayName quebraria em qualquer idioma
    // diferente de ingles.
    expect(folderRole('inbox')).toBe('INBOX');
    expect(folderRole('INBOX')).toBe('INBOX');
    expect(folderRole('sentitems')).toBe('SENT');
    expect(folderRole('deleteditems')).toBe('TRASH');
    expect(folderRole('junkemail')).toBe('SPAM');
    expect(folderRole('drafts')).toBe('CUSTOM');
    expect(folderRole('MinhaPastaPersonalizada')).toBe('CUSTOM');
  });
});

describe('normalizeGraphMessage', () => {
  function mensagem(over: Partial<GraphMessageResource> = {}): GraphMessageResource {
    return {
      id: 'msg1',
      conversationId: 'conv1',
      internetMessageId: '<abc@outlook.com>',
      subject: 'Assunto',
      bodyPreview: 'trecho',
      from: { emailAddress: { name: 'Camila', address: 'Camila@Parceiro.com' } },
      toRecipients: [{ emailAddress: { address: 'eu@outlook.com' } }],
      ccRecipients: [],
      receivedDateTime: '2026-08-30T10:00:00Z',
      isRead: false,
      flag: { flagStatus: 'notFlagged' },
      hasAttachments: false,
      ...over,
    };
  }

  it('usa os campos estruturados do Graph sem parsear cabecalho', () => {
    // O Graph ja devolve remetente/destinatarios como objetos, ao contrario
    // do Gmail que devolve cabecalhos crus.
    const normalizado = normalizeGraphMessage(mensagem(), 'folder-inbox');
    expect(normalizado.providerId).toBe('msg1');
    expect(normalizado.providerThreadId).toBe('conv1');
    expect(normalizado.rfcMessageId).toBe('<abc@outlook.com>');
    expect(normalizado.fromEmail).toBe('camila@parceiro.com');
    expect(normalizado.fromName).toBe('Camila');
    expect(normalizado.toEmails).toEqual(['eu@outlook.com']);
    expect(normalizado.mailboxProviderId).toBe('folder-inbox');
  });

  it('so marca como sinalizado quando o status e exatamente "flagged"', () => {
    expect(normalizeGraphMessage(mensagem({ flag: { flagStatus: 'flagged' } }), 'f').isFlagged).toBe(
      true,
    );
    expect(
      normalizeGraphMessage(mensagem({ flag: { flagStatus: 'complete' } }), 'f').isFlagged,
    ).toBe(false);
    expect(normalizeGraphMessage(mensagem({ flag: undefined }), 'f').isFlagged).toBe(false);
  });

  it('filtra destinatarios sem endereco', () => {
    const normalizado = normalizeGraphMessage(
      mensagem({ toRecipients: [{ emailAddress: { name: 'Sem email' } }, { emailAddress: { address: 'valido@x.com' } }] }),
      'f',
    );
    expect(normalizado.toEmails).toEqual(['valido@x.com']);
  });
});

describe('parseGraphEventWindow', () => {
  it('interpreta dateTime sem sufixo Z como UTC', () => {
    // Com o header Prefer: outlook.timezone="UTC", o Graph devolve dateTime
    // ja em UTC mas SEM o sufixo Z. Interpretar isso como hora local do
    // servidor (comportamento padrao do JS) desloca o horario.
    const janela = parseGraphEventWindow({
      id: 'e1',
      start: { dateTime: '2026-08-30T13:00:00.0000000' },
      end: { dateTime: '2026-08-30T14:00:00.0000000' },
    });
    expect(janela?.startsAt.toISOString()).toBe('2026-08-30T13:00:00.000Z');
  });

  it('aceita dateTime que ja vem com Z', () => {
    const janela = parseGraphEventWindow({
      id: 'e2',
      start: { dateTime: '2026-08-30T13:00:00Z' },
    });
    expect(janela?.startsAt.toISOString()).toBe('2026-08-30T13:00:00.000Z');
  });

  it('devolve null sem horario de inicio', () => {
    expect(parseGraphEventWindow({ id: 'e3' })).toBeNull();
  });
});

describe('normalizeGraphEvent', () => {
  function evento(over: Partial<GraphEventResource> = {}): GraphEventResource {
    return {
      id: 'evt1',
      iCalUId: 'evt1@outlook.com',
      subject: 'Reuniao',
      isAllDay: false,
      isCancelled: false,
      start: { dateTime: '2026-08-30T13:00:00Z' },
      end: { dateTime: '2026-08-30T14:00:00Z' },
      organizer: { emailAddress: { address: 'organizador@empresa.com' } },
      responseStatus: { response: 'accepted' },
      ...over,
    };
  }

  it('normaliza os campos principais', () => {
    const normalizado = normalizeGraphEvent(evento(), 'calendar1');
    expect(normalizado?.title).toBe('Reuniao');
    expect(normalizado?.status).toBe('CONFIRMED');
    expect(normalizado?.responseStatus).toBe('ACCEPTED');
    expect(normalizado?.iCalUid).toBe('evt1@outlook.com');
  });

  it('usa a resposta do proprio usuario direto do Graph, sem varrer participantes', () => {
    // Diferenca chave em relacao ao Google: o Graph ja resolve isso.
    expect(
      normalizeGraphEvent(evento({ responseStatus: { response: 'organizer' } }), 'c1')
        ?.responseStatus,
    ).toBe('ORGANIZER');
    expect(
      normalizeGraphEvent(evento({ responseStatus: { response: 'tentativelyAccepted' } }), 'c1')
        ?.responseStatus,
    ).toBe('TENTATIVE');
    expect(
      normalizeGraphEvent(evento({ responseStatus: { response: 'notResponded' } }), 'c1')
        ?.responseStatus,
    ).toBe('NEEDS_ACTION');
  });

  it('marca CANCELLED apenas quando isCancelled e verdadeiro', () => {
    expect(normalizeGraphEvent(evento({ isCancelled: true }), 'c1')?.status).toBe('CANCELLED');
    expect(normalizeGraphEvent(evento({ isCancelled: false }), 'c1')?.status).toBe('CONFIRMED');
  });

  it('usa onlineMeetingUrl como fallback quando nao ha onlineMeeting.joinUrl', () => {
    const normalizado = normalizeGraphEvent(
      evento({ onlineMeeting: undefined, onlineMeetingUrl: 'https://teams.microsoft.com/x' }),
      'c1',
    );
    expect(normalizado?.conferenceUrl).toBe('https://teams.microsoft.com/x');
  });

  it('prioriza onlineMeeting.joinUrl sobre onlineMeetingUrl', () => {
    const normalizado = normalizeGraphEvent(
      evento({
        onlineMeeting: { joinUrl: 'https://teams.microsoft.com/novo' },
        onlineMeetingUrl: 'https://teams.microsoft.com/antigo',
      }),
      'c1',
    );
    expect(normalizado?.conferenceUrl).toBe('https://teams.microsoft.com/novo');
  });

  it('devolve null para evento sem horario utilizavel', () => {
    expect(normalizeGraphEvent(evento({ start: undefined }), 'c1')).toBeNull();
  });
});
