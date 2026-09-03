import { describe, expect, it } from 'vitest';
import {
  interpretarEscolhaDeCategoria,
  interpretarEscolhaDeNegocio,
  menuDeCategorias,
  menuDeNegocios,
  pareceNomeDeArquivo,
} from './escolha';

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

describe('pareceNomeDeArquivo — anexo sem legenda manda o NOME no corpo', () => {
  it('reconhece o nome que o Twilio gera', () => {
    // Tratado como legenda, virava descricao "7172622995683306 pdf" e seus
    // digitos entravam na disputa por "qual numero e o valor" — foi de onde
    // saiu o numero que estourou a coluna.
    expect(pareceNomeDeArquivo('7172622995683306.pdf')).toBe(true);
    expect(pareceNomeDeArquivo('IMG_20260903_075812.jpg')).toBe(true);
    expect(pareceNomeDeArquivo('audio.ogg')).toBe(true);
  });

  it('legenda de verdade NAO e confundida com nome de arquivo', () => {
    for (const t of [
      'paguei o fornecedor XYZ, 1.200',
      'boleto da luz',
      'segue o comprovante',
      'nota fiscal 2026',
      '1.200',
    ]) {
      expect(pareceNomeDeArquivo(t)).toBe(false);
    }
  });

  it('extensao desconhecida nao conta', () => {
    expect(pareceNomeDeArquivo('coisa.xyz')).toBe(false);
  });
});

describe('interpretarEscolhaDeCategoria', () => {
  it('numero e nome da categoria', () => {
    expect(interpretarEscolhaDeCategoria('4')).toBe('Fornecedores');
    expect(interpretarEscolhaDeCategoria('fornecedores')).toBe('Fornecedores');
    expect(interpretarEscolhaDeCategoria('marketing')).toBe('Marketing');
  });

  it('aceita ate o 17, que e o tamanho da lista', () => {
    expect(interpretarEscolhaDeCategoria('17')).toBe('Outros');
    expect(interpretarEscolhaDeCategoria('18')).toBeUndefined();
  });

  it('despesa continua nao sendo resposta', () => {
    expect(interpretarEscolhaDeCategoria('paguei 4')).toBeUndefined();
    expect(interpretarEscolhaDeCategoria('R$ 4')).toBeUndefined();
  });

  it('o menu numera na mesma ordem que a leitura', () => {
    const menu = menuDeCategorias();
    expect(menu.split(' · ')[3]).toBe(`4 ${interpretarEscolhaDeCategoria('4')}`);
  });
});
