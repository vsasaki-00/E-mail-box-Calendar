import { describe, expect, it } from 'vitest';
import { nomeDaInstituicao, nomeDoBanco } from './bancos';

describe('nomeDoBanco', () => {
  it('reconhece com e sem zero a esquerda', () => {
    expect(nomeDoBanco('0260')).toBe('Nubank');
    expect(nomeDoBanco('260')).toBe('Nubank');
    expect(nomeDoBanco('0341')).toBe('Itaú');
    expect(nomeDoBanco('001')).toBe('Banco do Brasil');
    expect(nomeDoBanco('0033 ')).toBe('Santander');
  });
  it('codigo desconhecido ou vazio nao inventa', () => {
    expect(nomeDoBanco('9999')).toBeUndefined();
    expect(nomeDoBanco('')).toBeUndefined();
    expect(nomeDoBanco(undefined)).toBeUndefined();
    expect(nomeDoBanco('abc')).toBeUndefined();
  });
});

describe('nomeDaInstituicao', () => {
  it('o que voce gravou vence o codigo', () => {
    expect(nomeDaInstituicao({ institution: 'Itaú PJ', bankId: '0260' })).toBe('Itaú PJ');
  });
  it('sem instituicao, o banco pelo codigo; sem banco conhecido, o codigo', () => {
    expect(nomeDaInstituicao({ institution: null, bankId: '0260' })).toBe('Nubank');
    expect(nomeDaInstituicao({ institution: '  ', bankId: '9999' })).toBe('9999');
    expect(nomeDaInstituicao({ institution: null, bankId: null })).toBeUndefined();
  });
});
