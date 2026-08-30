import { describe, expect, it } from 'vitest';
import {
  eventDedupeKey,
  messageDedupeKey,
  normalizeEmail,
  normalizeSubject,
  groupByDedupeKey,
} from './dedupe';

describe('normalizeSubject', () => {
  it('remove prefixos de resposta empilhados, em varios idiomas', () => {
    expect(normalizeSubject('RE: Re: Fwd: Contrato')).toBe('contrato');
    expect(normalizeSubject('ENC: Res: Proposta')).toBe('proposta');
    expect(normalizeSubject('RE[2]: Reuniao')).toBe('reuniao');
  });

  it('colapsa espacos e ignora caixa', () => {
    expect(normalizeSubject('  Contrato   Final  ')).toBe('contrato final');
  });

  it('trata ausencia de assunto', () => {
    expect(normalizeSubject(null)).toBe('');
    expect(normalizeSubject(undefined)).toBe('');
  });
});

describe('normalizeEmail', () => {
  it('extrai o endereco de um cabecalho com nome de exibicao', () => {
    expect(normalizeEmail('Camila Duarte <Camila@Parceiro.com>')).toBe('camila@parceiro.com');
  });

  it('normaliza enderecos simples', () => {
    expect(normalizeEmail('  ALGUEM@Exemplo.COM ')).toBe('alguem@exemplo.com');
  });
});

describe('messageDedupeKey', () => {
  it('agrupa o mesmo e-mail recebido em caixas diferentes', () => {
    const base = {
      rfcMessageId: '<convite@parceiro.com>',
      fromEmail: 'camila@parceiro.com',
      subject: 'Convite',
      receivedAt: new Date('2026-08-30T10:00:00Z'),
    };
    // A segunda caixa entrega o mesmo Message-ID com caixa e delimitadores
    // diferentes, e alguns segundos depois.
    const outraCaixa = {
      ...base,
      rfcMessageId: 'Convite@Parceiro.com',
      receivedAt: new Date('2026-08-30T10:00:20Z'),
    };
    expect(messageDedupeKey(base)).toBe(messageDedupeKey(outraCaixa));
  });

  it('separa mensagens distintas', () => {
    const a = messageDedupeKey({
      rfcMessageId: '<a@x.com>',
      receivedAt: new Date('2026-08-30T10:00:00Z'),
    });
    const b = messageDedupeKey({
      rfcMessageId: '<b@x.com>',
      receivedAt: new Date('2026-08-30T10:00:00Z'),
    });
    expect(a).not.toBe(b);
  });

  it('cai para o hash quando falta Message-ID, tolerando diferenca de relogio', () => {
    const identidade = {
      rfcMessageId: null,
      fromEmail: 'Camila@Parceiro.com',
      subject: 'RE: Contrato',
      receivedAt: new Date('2026-08-30T10:00:10Z'),
    };
    const mesmaMensagemOutraCaixa = {
      rfcMessageId: null,
      fromEmail: 'camila@parceiro.com',
      subject: 'Contrato',
      receivedAt: new Date('2026-08-30T10:00:25Z'),
    };
    const chave = messageDedupeKey(identidade);
    expect(chave.startsWith('msg:h:')).toBe(true);
    expect(chave).toBe(messageDedupeKey(mesmaMensagemOutraCaixa));
  });

  it('nao agrupa mensagens separadas por muito tempo', () => {
    const cedo = messageDedupeKey({
      fromEmail: 'a@x.com',
      subject: 'Relatorio diario',
      receivedAt: new Date('2026-08-30T10:00:00Z'),
    });
    const tarde = messageDedupeKey({
      fromEmail: 'a@x.com',
      subject: 'Relatorio diario',
      receivedAt: new Date('2026-08-31T10:00:00Z'),
    });
    expect(cedo).not.toBe(tarde);
  });
});

describe('eventDedupeKey', () => {
  it('agrupa o mesmo convite visto em duas contas', () => {
    const inicio = new Date('2026-08-30T13:00:00Z');
    expect(
      eventDedupeKey({ iCalUid: 'reuniao@parceiro.com', startsAt: inicio }),
    ).toBe(eventDedupeKey({ iCalUid: 'Reuniao@Parceiro.com', startsAt: inicio }));
  });

  it('mantem ocorrencias da mesma serie recorrente separadas', () => {
    const segunda = eventDedupeKey({
      iCalUid: 'daily@empresa.com',
      startsAt: new Date('2026-08-31T12:00:00Z'),
    });
    const terca = eventDedupeKey({
      iCalUid: 'daily@empresa.com',
      startsAt: new Date('2026-09-01T12:00:00Z'),
    });
    expect(segunda).not.toBe(terca);
  });
});

describe('groupByDedupeKey', () => {
  it('junta as copias sob a mesma chave', () => {
    const copias = [
      { id: '1', chave: 'a' },
      { id: '2', chave: 'a' },
      { id: '3', chave: 'b' },
    ];
    const grupos = groupByDedupeKey(copias, (item) => item.chave);
    expect(grupos.get('a')).toHaveLength(2);
    expect(grupos.get('b')).toHaveLength(1);
  });
});
