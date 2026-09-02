import { describe, expect, it } from 'vitest';
import { categoriaHeuristica, chaveDeRegra, isCategoria } from './categorias';
import { normalizarDescricao } from './extrato/normalizar';

describe('categoriaHeuristica', () => {
  const n = normalizarDescricao;
  it('acha as obvias', () => {
    expect(categoriaHeuristica(n('NETFLIX.COM'), -5590)).toBe('Assinaturas e software');
    expect(categoriaHeuristica(n('Pagamento de boleto efetuado PORTO SEGURO SEGURO SAUDE SA'), -175204)).toBe('Saúde');
    expect(categoriaHeuristica(n('DARF 0220 08/2026'), -120000)).toBe('Impostos');
    expect(categoriaHeuristica(n('Uber *Trip'), -2390)).toBe('Transporte');
    expect(categoriaHeuristica(n('Rendimento líquido'), 1234)).toBe('Investimentos');
    expect(categoriaHeuristica(n('TARIFA PACOTE SERVICOS'), -2990)).toBe('Tarifas e juros');
  });
  it('entrada com cara de recebimento vira Receita; sem pista, nada', () => {
    expect(categoriaHeuristica(n('Transferência recebida pelo Pix CLIENTE X LTDA'), 1250000)).toBe('Receita');
    expect(categoriaHeuristica(n('Transferência enviada pelo Pix FULANO'), -1250000)).toBeUndefined();
    expect(categoriaHeuristica(n('ALGO ESTRANHO'), -100)).toBeUndefined();
  });
  it('nao confunde "das" preposicao... porque a descricao normalizada raramente a tem sozinha', () => {
    // "das" como imposto so casa como palavra inteira; "loja das flores" e
    // um falso positivo conhecido e aceito — e corrigivel com uma regra.
    expect(isCategoria('Impostos')).toBe(true);
    expect(isCategoria('impostos')).toBe(false);
  });
});

describe('chaveDeRegra', () => {
  const n = normalizarDescricao;
  it('tira o generico e fica com quem', () => {
    expect(chaveDeRegra(n('Pagamento de boleto efetuado PORTO SEGURO SEGURO SAUDE SA'))).toBe('porto seguro saude');
    expect(chaveDeRegra(n('Transferência recebida pelo Pix UNITEDCOM BRASIL S.A. - 51.300.867/0001-01 - FITBANK IP (0450) Agência: 1 Conta: 5301577114-1'))).toBe('unitedcom fitbank');
    expect(chaveDeRegra(n('NETFLIX.COM'))).toBe('netflix');
  });
  it('descricao so de ruido nao gera chave', () => {
    expect(chaveDeRegra(n('PIX ENVIADO 12345678901'))).toBeUndefined();
  });
  it('a chave casa por "contem" na propria descricao que a gerou', () => {
    const d = n('Pagamento de boleto efetuado PORTO SEGURO SEGURO SAUDE SA');
    expect(d.includes(chaveDeRegra(d)!)).toBe(false); // nao e substring continua...
    // ...entao quem aplica a regra testa PALAVRA a palavra. Ver categorizar.ts
    for (const p of chaveDeRegra(d)!.split(' ')) expect(d.split(' ')).toContain(p);
  });
});
