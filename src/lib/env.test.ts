import { describe, expect, it } from 'vitest';
import { envNumero, envOu } from './env';
import { DEFAULT_TRIAGE_MODEL } from '@/core/triage/classifier';

describe('envOu', () => {
  /**
   * O caso que quebrou a triagem em producao: a variavel existe e esta
   * vazia, porque foi copiada do .env.example (TRIAGE_MODEL="") ou criada
   * no painel sem valor. Com `??` isso passava adiante e a API respondia
   * `model: String should have at least 1 character` em TODA mensagem.
   */
  it('trata string vazia como ausente', () => {
    expect(envOu('', DEFAULT_TRIAGE_MODEL)).toBe(DEFAULT_TRIAGE_MODEL);
    expect(envOu(undefined, DEFAULT_TRIAGE_MODEL)).toBe(DEFAULT_TRIAGE_MODEL);
    // Espaco em branco tambem: colar com espaco sobrando e comum.
    expect(envOu('   ', DEFAULT_TRIAGE_MODEL)).toBe(DEFAULT_TRIAGE_MODEL);
  });

  it('respeita um valor de verdade, aparando espacos', () => {
    expect(envOu('claude-sonnet-5', DEFAULT_TRIAGE_MODEL)).toBe('claude-sonnet-5');
    expect(envOu('  claude-sonnet-5  ', DEFAULT_TRIAGE_MODEL)).toBe('claude-sonnet-5');
  });

  it('o padrao nunca e vazio — senao o conserto nao conserta nada', () => {
    expect(DEFAULT_TRIAGE_MODEL.length).toBeGreaterThan(0);
  });
});

describe('envNumero', () => {
  /**
   * O caso que zerava a agenda: SYNC_CALENDAR_FUTURE_MONTHS declarada e
   * VAZIA. `Number('')` e ZERO, nao NaN — entao a janela virava "de agora
   * ate agora", os calendarios eram descobertos normalmente e nenhum evento
   * cabia no intervalo. Sem erro em lugar nenhum.
   */
  it('trata vazio como ausente, e nao como zero', () => {
    expect(envNumero('', 12)).toBe(12);
    expect(envNumero('   ', 12)).toBe(12);
    expect(envNumero(undefined, 12)).toBe(12);
  });

  it('trata valor nao numerico como ausente', () => {
    // `Number('doze')` e NaN, que propagaria como data invalida.
    expect(envNumero('doze', 12)).toBe(12);
  });

  it('respeita um numero de verdade, inclusive zero explicito', () => {
    expect(envNumero('3', 12)).toBe(3);
    expect(envNumero(' 3 ', 12)).toBe(3);
    // Zero ESCRITO e uma escolha, diferente de zero por acidente.
    expect(envNumero('0', 12)).toBe(0);
  });
});
