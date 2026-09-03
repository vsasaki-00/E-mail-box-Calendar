import { describe, expect, it } from 'vitest';
import { chaveDeNome, normalizarNome, precisaMigrar, validarNome, MAX_NOME } from './negocios';

describe('normalizarNome — encosta no canonico sem apagar a marca', () => {
  it('colapsa espaco e apara as pontas', () => {
    expect(normalizarNome('  Cordex   AI  ')).toBe('Cordex AI');
    expect(normalizarNome('Brand.co\n')).toBe('Brand.co');
  });

  it('NAO mexe em acento, maiuscula nem ponto — o nome e do dono', () => {
    expect(normalizarNome('Cordex.AI')).toBe('Cordex.AI');
    expect(normalizarNome('Ação Já')).toBe('Ação Já');
  });

  it('corta no maximo', () => {
    expect(normalizarNome('x'.repeat(80))).toHaveLength(MAX_NOME);
  });
});

describe('validarNome', () => {
  const existentes = ['Unitedcom', 'Cordex.AI', 'Brand.co'];

  it('aceita nome novo', () => {
    expect(validarNome('Meridiano', existentes)).toBeUndefined();
  });

  it('recusa vazio e so-espaco', () => {
    expect(validarNome('', existentes)).toBe('vazio');
    expect(validarNome('    ', existentes)).toBe('vazio');
  });

  it('recusa duplicado mesmo com grafia diferente', () => {
    // No prompt de triagem os dois seriam contextos separados para o MESMO
    // negocio — que e o bug original que a lista fixa existia para evitar.
    expect(validarNome('brand co', existentes)).toBe('duplicado');
    expect(validarNome('CORDEX.AI', existentes)).toBe('duplicado');
    expect(validarNome('  unitedcom ', existentes)).toBe('duplicado');
  });

  it('recusa nome so de simbolos', () => {
    // Passaria no comprimento e viraria um nome que nenhuma comparacao casa.
    expect(validarNome('...', existentes)).toBe('so-simbolos');
    expect(validarNome('---', existentes)).toBe('so-simbolos');
  });

  it('recusa nome de uma letra', () => {
    expect(validarNome('X', existentes)).toBe('curto');
  });
});

describe('chaveDeNome', () => {
  it('ignora acento, caixa e pontuacao', () => {
    expect(chaveDeNome('Cordex.AI')).toBe(chaveDeNome('cordex ai'));
    expect(chaveDeNome('Ação')).toBe(chaveDeNome('acao'));
  });

  it('nomes diferentes continuam diferentes', () => {
    expect(chaveDeNome('Brand.co')).not.toBe(chaveDeNome('Brandy'));
  });
});

describe('precisaMigrar', () => {
  it('mudanca de CAIXA tambem migra — as linhas guardam o texto', () => {
    // Sem migrar, o filtro por "Brand.CO" devolveria menos do que existe.
    expect(precisaMigrar('Brand.co', 'Brand.CO')).toBe(true);
  });

  it('so espaco a mais nao e mudanca', () => {
    expect(precisaMigrar('Brand.co', '  Brand.co ')).toBe(false);
  });

  it('nome diferente migra', () => {
    expect(precisaMigrar('Brand.co', 'Brand')).toBe(true);
  });
});
