import { describe, expect, it, afterEach } from 'vitest';
import { assinaturaJanela, janelaCalendario } from './janela-calendario';
import {
  CHAVE_JANELA,
  lerJanelaDoCursor,
  parseContainerCursor,
  serializeContainerCursor,
} from './container-cursor';

/**
 * O bug que estes testes travam: a janela do calendario nao e reenviada a
 * cada sync — ela fica gravada dentro do syncToken (Google) e do deltaLink
 * (Microsoft). Corrigir SYNC_CALENDAR_* nao chegava ao provedor, porque o
 * cursor velho continuava mandando na janela velha.
 */

const original = {
  passado: process.env.SYNC_CALENDAR_PAST_MONTHS,
  futuro: process.env.SYNC_CALENDAR_FUTURE_MONTHS,
};

afterEach(() => {
  process.env.SYNC_CALENDAR_PAST_MONTHS = original.passado;
  process.env.SYNC_CALENDAR_FUTURE_MONTHS = original.futuro;
});

describe('assinaturaJanela', () => {
  it('nao muda dentro do mesmo mes — senao todo sync viraria full sync', () => {
    delete process.env.SYNC_CALENDAR_PAST_MONTHS;
    delete process.env.SYNC_CALENDAR_FUTURE_MONTHS;
    const dia1 = assinaturaJanela(new Date('2026-09-02T10:00:00Z'));
    const dia28 = assinaturaJanela(new Date('2026-09-28T23:59:00Z'));
    expect(dia28).toBe(dia1);
  });

  it('muda ao virar o mes, para o horizonte futuro nao encolher para sempre', () => {
    const setembro = assinaturaJanela(new Date('2026-09-30T23:00:00Z'));
    const outubro = assinaturaJanela(new Date('2026-10-01T01:00:00Z'));
    expect(outubro).not.toBe(setembro);
  });

  it('muda quando a configuracao muda', () => {
    const agora = new Date('2026-09-02T10:00:00Z');
    process.env.SYNC_CALENDAR_FUTURE_MONTHS = '12';
    const doze = assinaturaJanela(agora);
    process.env.SYNC_CALENDAR_FUTURE_MONTHS = '24';
    expect(assinaturaJanela(agora)).not.toBe(doze);
  });

  it('env vazia cai no padrao, e nao em zero (Number("") === 0)', () => {
    const agora = new Date('2026-09-02T10:00:00Z');
    delete process.env.SYNC_CALENDAR_PAST_MONTHS;
    delete process.env.SYNC_CALENDAR_FUTURE_MONTHS;
    const padrao = assinaturaJanela(agora);
    process.env.SYNC_CALENDAR_PAST_MONTHS = '';
    process.env.SYNC_CALENDAR_FUTURE_MONTHS = '   ';
    expect(assinaturaJanela(agora)).toBe(padrao);
  });
});

describe('janelaCalendario', () => {
  it('abre 1 mes para tras e 12 para frente por padrao', () => {
    delete process.env.SYNC_CALENDAR_PAST_MONTHS;
    delete process.env.SYNC_CALENDAR_FUTURE_MONTHS;
    const { since, until } = janelaCalendario(new Date('2026-09-02T10:00:00Z'));
    expect(since.toISOString().slice(0, 7)).toBe('2026-08');
    expect(until.toISOString().slice(0, 7)).toBe('2027-09');
  });

  it('env vazia nao colapsa a janela em "agora ate agora"', () => {
    process.env.SYNC_CALENDAR_PAST_MONTHS = '';
    process.env.SYNC_CALENDAR_FUTURE_MONTHS = '';
    const { since, until } = janelaCalendario(new Date('2026-09-02T10:00:00Z'));
    expect(until.getTime() - since.getTime()).toBeGreaterThan(300 * 24 * 3600 * 1000);
  });
});

describe('janela dentro do cursor', () => {
  const tokens = { 'cal-1': 'delta-abc', 'cal-2': 'delta-def' };

  it('guarda e le a assinatura sem confundi-la com um calendario', () => {
    const cursor = serializeContainerCursor(tokens, 'p1f12@2026-09');
    expect(lerJanelaDoCursor(cursor)).toBe('p1f12@2026-09');
    expect(parseContainerCursor(cursor)).toEqual(tokens);
    expect(Object.keys(parseContainerCursor(cursor))).not.toContain(CHAVE_JANELA);
  });

  it('cursor antigo, gravado antes deste campo, nao tem janela — e refaz o full sync', () => {
    const antigo = JSON.stringify(tokens);
    expect(lerJanelaDoCursor(antigo)).toBeUndefined();
    // Ainda le os tokens: quem decide descartar e o conector, comparando.
    expect(parseContainerCursor(antigo)).toEqual(tokens);
  });

  it('sem nenhum container nao inventa cursor so para carregar a janela', () => {
    expect(serializeContainerCursor({}, 'p1f12@2026-09')).toBeUndefined();
  });

  it('cursor corrompido nao explode', () => {
    expect(lerJanelaDoCursor('{nao e json')).toBeUndefined();
    expect(lerJanelaDoCursor('[]')).toBeUndefined();
    expect(parseContainerCursor('{nao e json')).toEqual({});
  });
});
