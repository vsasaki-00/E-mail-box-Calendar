import { describe, expect, it } from 'vitest';
import { interpretarEscolhaDeNegocio, menuDeNegocios } from './escolha';

const escolha = interpretarEscolhaDeNegocio;

describe('interpretarEscolhaDeNegocio', () => {
  it('numero do menu vira o negocio', () => {
    expect(escolha('1')).toBe('Unitedcom');
    expect(escolha('3')).toBe('Brand.co');
    expect(escolha('6')).toBe('Pessoais');
    expect(escolha(' 2 ')).toBe('Cordex.AI');
  });

  it('numero fora do menu nao vira nada', () => {
    expect(escolha('0')).toBeUndefined();
    expect(escolha('7')).toBeUndefined();
    expect(escolha('99')).toBeUndefined();
  });

  it('nome escrito tambem vale, com ou sem acento e pontuacao', () => {
    expect(escolha('unitedcom')).toBe('Unitedcom');
    expect(escolha('Cordex.AI')).toBe('Cordex.AI');
    expect(escolha('cordex ai')).toBe('Cordex.AI');
    expect(escolha('brand.co')).toBe('Brand.co');
    expect(escolha('pessoais')).toBe('Pessoais');
  });

  it('prefixo resolve quando identifica UM negocio so', () => {
    expect(escolha('brand')).toBe('Brand.co');
    expect(escolha('empreenda')).toBe('EmpreendaSim');
    // Prefixo que nao existe nao chuta.
    expect(escolha('xyz')).toBeUndefined();
  });

  it('DESPESA nunca e confundida com resposta — o erro caro', () => {
    // Uma despesa perdida some do painel; uma resposta perdida voce repete.
    for (const frase of [
      'paguei 3',
      'gastei 3 reais',
      'recebi 3',
      'R$ 3',
      '3 reais',
      'pix 3',
      'paguei o fornecedor XYZ, 1.200',
    ]) {
      expect(escolha(frase)).toBeUndefined();
    }
  });

  it('numero com decimal ou sufixo nao e escolha de menu', () => {
    expect(escolha('3,50')).toBeUndefined();
    expect(escolha('3.50')).toBeUndefined();
    expect(escolha('3 mil')).toBeUndefined();
    expect(escolha('1200')).toBeUndefined();
  });

  it('frase longa nao e resposta, mesmo comecando com numero', () => {
    expect(escolha('3 - foi aquele fornecedor que a gente conversou ontem de manha')).toBeUndefined();
  });

  it('vazio e lixo nao explodem', () => {
    expect(escolha('')).toBeUndefined();
    expect(escolha('   ')).toBeUndefined();
    expect(escolha('???')).toBeUndefined();
  });
});

describe('menuDeNegocios', () => {
  it('numera na mesma ordem que a leitura da resposta', () => {
    const menu = menuDeNegocios();
    expect(menu).toContain('1 Unitedcom');
    expect(menu).toContain('6 Pessoais');
    // A ordem do menu E a ordem do indice: se divergirem, "3" anota errado.
    const terceiro = menu.split(' · ')[2];
    expect(terceiro).toBe(`3 ${escolha('3')}`);
  });
});
