import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CONTEXTS,
  BUSINESS_DEFAULTS,
  formatList,
  isBusinessContext,
  parseList,
} from './businesses';

describe('BUSINESS_CONTEXTS', () => {
  it('contem os contextos informados pelo usuario', () => {
    expect(BUSINESS_CONTEXTS).toEqual([
      'Unitedcom',
      'Cordex.AI',
      'Brand.co',
      'EmpreendaSim',
      'Outros',
      'Pessoais',
    ]);
  });

  it('tem default para cada contexto, sem faltar nenhum', () => {
    for (const contexto of BUSINESS_CONTEXTS) {
      expect(BUSINESS_DEFAULTS[contexto]).toBeDefined();
      expect(BUSINESS_DEFAULTS[contexto].objectiveHint.length).toBeGreaterThan(0);
    }
  });

  it('caixa de negocio erra para o lado de mostrar; a pessoal pode filtrar mais', () => {
    // Esconder o primeiro e-mail de um cliente novo e um dano invisivel;
    // esconder uma newsletter pessoal nao custa nada.
    expect(BUSINESS_DEFAULTS.Unitedcom.calibration).toBe('CONSERVATIVE');
    expect(BUSINESS_DEFAULTS['Cordex.AI'].calibration).toBe('CONSERVATIVE');
    expect(BUSINESS_DEFAULTS['Brand.co'].calibration).toBe('CONSERVATIVE');
    expect(BUSINESS_DEFAULTS.EmpreendaSim.calibration).toBe('CONSERVATIVE');
    expect(BUSINESS_DEFAULTS.Pessoais.calibration).toBe('AGGRESSIVE');
  });

  it('so sugere palavras-chave onde a area do negocio e conhecida', () => {
    // Brand.co e o unico cuja area o usuario informou (palestras/
    // treinamentos). Chutar palavras para os outros viraria instrucao
    // errada dentro do prompt.
    expect(BUSINESS_DEFAULTS['Brand.co'].urgentKeywords).toContain('palestra');
    expect(BUSINESS_DEFAULTS.Unitedcom.urgentKeywords).toEqual([]);
    expect(BUSINESS_DEFAULTS['Cordex.AI'].urgentKeywords).toEqual([]);
    expect(BUSINESS_DEFAULTS.EmpreendaSim.urgentKeywords).toEqual([]);
  });
});

describe('isBusinessContext', () => {
  it('aceita os contextos validos e rejeita o resto', () => {
    expect(isBusinessContext('Cordex.AI')).toBe(true);
    expect(isBusinessContext('cordex.ai')).toBe(false); // caixa importa
    expect(isBusinessContext('Inventado')).toBe(false);
  });
});

describe('parseList', () => {
  it('aceita virgula, ponto-e-virgula e quebra de linha', () => {
    expect(parseList('a@x.com, b@y.com')).toEqual(['a@x.com', 'b@y.com']);
    expect(parseList('a@x.com\nb@y.com')).toEqual(['a@x.com', 'b@y.com']);
    expect(parseList('a@x.com; b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('normaliza caixa e remove espaco solto', () => {
    // Um espaco solto aqui vira ruido no prompt de toda mensagem da caixa.
    expect(parseList('  Cliente@Grande.COM  ')).toEqual(['cliente@grande.com']);
  });

  it('remove duplicados, inclusive os que so diferem na caixa', () => {
    expect(parseList('a@x.com, A@X.com, a@x.com')).toEqual(['a@x.com']);
  });

  it('ignora entradas vazias', () => {
    expect(parseList('a@x.com,,  ,\n\nb@y.com')).toEqual(['a@x.com', 'b@y.com']);
    expect(parseList('')).toEqual([]);
    expect(parseList('   ')).toEqual([]);
  });

  it('preserva a ordem de digitacao', () => {
    expect(parseList('zeta, alfa, meio')).toEqual(['zeta', 'alfa', 'meio']);
  });
});

describe('formatList', () => {
  it('devolve uma entrada por linha para a textarea', () => {
    expect(formatList(['a@x.com', 'b@y.com'])).toBe('a@x.com\nb@y.com');
  });

  it('lida com valor ausente ou de tipo errado vindo do Json do banco', () => {
    expect(formatList(null)).toBe('');
    expect(formatList(undefined)).toBe('');
    expect(formatList('nao e array')).toBe('');
  });

  it('faz o ciclo completo com parseList', () => {
    const original = 'cliente@grande.com\nfornecedor.com';
    expect(formatList(parseList(original))).toBe(original);
  });
});
