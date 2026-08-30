import { describe, expect, it } from 'vitest';
import {
  decodeImapCursor,
  encodeImapCursor,
  mailboxRoleFromSpecialUse,
  normalizeImapMessage,
  type ImapFetchedMessage,
} from './imap-normalize';

describe('mailboxRoleFromSpecialUse', () => {
  it('traduz as flags SPECIAL-USE do imapflow', () => {
    // O imapflow ja resolve nome localizado -> flag (specialUseSource:
    // 'name'), entao so precisamos traduzir a flag resolvida.
    expect(mailboxRoleFromSpecialUse('\\Inbox')).toBe('INBOX');
    expect(mailboxRoleFromSpecialUse('\\Sent')).toBe('SENT');
    expect(mailboxRoleFromSpecialUse('\\Trash')).toBe('TRASH');
    expect(mailboxRoleFromSpecialUse('\\Junk')).toBe('SPAM');
  });

  it('cai para CUSTOM sem SPECIAL-USE reconhecido', () => {
    expect(mailboxRoleFromSpecialUse(undefined)).toBe('CUSTOM');
    expect(mailboxRoleFromSpecialUse('\\Archive')).toBe('CUSTOM');
    expect(mailboxRoleFromSpecialUse('\\Flagged')).toBe('CUSTOM');
  });
});

describe('normalizeImapMessage', () => {
  function mensagem(over: Partial<ImapFetchedMessage> = {}): ImapFetchedMessage {
    return {
      uid: 42,
      envelope: {
        subject: 'Assunto',
        messageId: '<abc@servidor.com>',
        from: [{ name: 'Camila', address: 'Camila@Parceiro.com' }],
        to: [{ address: 'eu@dominio.com' }],
        cc: [],
        date: new Date('2026-08-30T10:00:00Z'),
      },
      flags: new Set(['\\Seen']),
      internalDate: new Date('2026-08-30T10:05:00Z'),
      ...over,
    };
  }

  it('usa o UID como providerId', () => {
    expect(normalizeImapMessage(mensagem(), 'INBOX').providerId).toBe('42');
  });

  it('normaliza remetente e destinatarios do envelope', () => {
    const normalizado = normalizeImapMessage(mensagem(), 'INBOX');
    expect(normalizado.fromEmail).toBe('camila@parceiro.com');
    expect(normalizado.fromName).toBe('Camila');
    expect(normalizado.toEmails).toEqual(['eu@dominio.com']);
  });

  it('prefere internalDate sobre a data do envelope', () => {
    // internalDate e o horario que o servidor registrou o recebimento; a
    // data do envelope vem do cabecalho Date, que o remetente controla.
    const normalizado = normalizeImapMessage(mensagem(), 'INBOX');
    expect(normalizado.receivedAt.toISOString()).toBe('2026-08-30T10:05:00.000Z');
  });

  it('deduz nao-lido pela ausencia da flag \\Seen', () => {
    expect(normalizeImapMessage(mensagem({ flags: new Set(['\\Seen']) }), 'f').isRead).toBe(true);
    expect(normalizeImapMessage(mensagem({ flags: new Set([]) }), 'f').isRead).toBe(false);
  });

  it('marca sinalizado pela flag \\Flagged', () => {
    expect(
      normalizeImapMessage(mensagem({ flags: new Set(['\\Seen', '\\Flagged']) }), 'f').isFlagged,
    ).toBe(true);
  });

  it('aproxima presenca de anexo por ter mais de um node no bodyStructure', () => {
    expect(
      normalizeImapMessage(mensagem({ bodyStructure: { childNodes: [{}, {}] } }), 'f')
        .hasAttachments,
    ).toBe(true);
    expect(
      normalizeImapMessage(mensagem({ bodyStructure: { childNodes: [{}] } }), 'f').hasAttachments,
    ).toBe(false);
    expect(normalizeImapMessage(mensagem({ bodyStructure: undefined }), 'f').hasAttachments).toBe(
      false,
    );
  });

  it('funciona sem envelope, sem quebrar', () => {
    const normalizado = normalizeImapMessage({ uid: 7, flags: new Set() }, 'INBOX');
    expect(normalizado.providerId).toBe('7');
    expect(normalizado.fromEmail).toBeUndefined();
    expect(normalizado.toEmails).toEqual([]);
  });
});

describe('encodeImapCursor / decodeImapCursor', () => {
  it('faz o ciclo completo preservando os campos', () => {
    const cursor = { uidValidity: '123456', lastUid: 88, highestModseq: '999' };
    expect(decodeImapCursor(encodeImapCursor(cursor))).toEqual(cursor);
  });

  it('omite highestModseq quando ausente (servidor sem CONDSTORE)', () => {
    const cursor = { uidValidity: '1', lastUid: 5 };
    const decodificado = decodeImapCursor(encodeImapCursor(cursor));
    expect(decodificado?.highestModseq).toBeUndefined();
  });

  it('descarta cursor corrompido em vez de estourar, forcando full sync', () => {
    expect(decodeImapCursor('{ isso nao e json')).toBeUndefined();
    expect(decodeImapCursor('{"uidValidity": 123}')).toBeUndefined(); // tipo errado
    expect(decodeImapCursor(undefined)).toBeUndefined();
  });
});
