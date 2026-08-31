import { describe, expect, it } from 'vitest';
import { envOu } from './env';
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
