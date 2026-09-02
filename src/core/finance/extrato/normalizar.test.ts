import { describe, expect, it } from 'vitest';
import { hashDoArquivo, impressaoDigital, normalizarDescricao } from './normalizar';
import { lerExtrato } from './ler';

describe('normalizarDescricao', () => {
  it('tira acento, caixa e pontuacao', () => {
    expect(normalizarDescricao('Padaria São João Ltda.')).toBe('padaria sao joao ltda');
  });
  it('tira data, final de cartao e numero longo — o que muda entre compras iguais', () => {
    expect(normalizarDescricao('COMPRA CARTAO 15/08 SUPERMERCADO X ****1234')).toBe('supermercado x');
    expect(normalizarDescricao('COMPRA CARTAO 22/08 SUPERMERCADO X ****1234')).toBe('supermercado x');
    expect(normalizarDescricao('PIX ENVIADO 12345678901 FORNECEDOR XYZ')).toBe('fornecedor xyz');
  });
  it('tira parcela', () => {
    expect(normalizarDescricao('MAGAZINE LUIZA PARC 03/12')).toBe('magazine luiza');
  });
  it('mantem o que identifica', () => {
    expect(normalizarDescricao('NETFLIX.COM')).toBe('netflix com');
    expect(normalizarDescricao('Uber *Trip')).toBe('uber trip');
  });
});

describe('impressaoDigital', () => {
  const base = { postedAt: new Date('2026-08-15T15:00:00Z'), amountCents: -4590, normalized: 'cafe' };

  it('com FITID, e o FITID', () => {
    expect(impressaoDigital({ ...base, fitId: 'abc', ocorrencia: 0 })).toBe('fitid:abc');
  });
  it('sem FITID, e estavel e muda com a ocorrencia (dois cafes no mesmo dia)', () => {
    const a = impressaoDigital({ ...base, ocorrencia: 0 });
    const b = impressaoDigital({ ...base, ocorrencia: 0 });
    const c = impressaoDigital({ ...base, ocorrencia: 1 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('hash:')).toBe(true);
  });
  it('muda com valor e com dia', () => {
    const a = impressaoDigital({ ...base, ocorrencia: 0 });
    expect(impressaoDigital({ ...base, amountCents: -4591, ocorrencia: 0 })).not.toBe(a);
    expect(impressaoDigital({ ...base, postedAt: new Date('2026-08-16T15:00:00Z'), ocorrencia: 0 })).not.toBe(a);
  });
});

describe('lerExtrato — decodificacao', () => {
  it('Latin-1 (como os bancos mandam) nao vira caractere quebrado', async () => {
    const latin1 = Buffer.from('Data;Descrição;Valor\n15/08/2026;Padaria São João;-10,00\n', 'latin1');
    const r = await lerExtrato(latin1);
    expect(r.lancamentos[0]?.description).toBe('Padaria São João');
  });
  it('UTF-8 com BOM tambem', async () => {
    const utf8 = Buffer.from('﻿Data;Descrição;Valor\n15/08/2026;Padaria São João;-10,00\n', 'utf8');
    expect((await lerExtrato(utf8)).lancamentos[0]?.description).toBe('Padaria São João');
  });
  it('OFX e CSV sao distinguidos pelo conteudo, nao pela extensao', async () => {
    expect((await lerExtrato(Buffer.from('OFXHEADER:100\n<OFX></OFX>'))).formato).toBe('OFX');
    expect((await lerExtrato(Buffer.from('Data;Descrição;Valor\n'))).formato).toBe('CSV');
  });
  it('hashDoArquivo e determinista', () => {
    expect(hashDoArquivo(Buffer.from('x'))).toBe(hashDoArquivo(Buffer.from('x')));
    expect(hashDoArquivo(Buffer.from('x'))).not.toBe(hashDoArquivo(Buffer.from('y')));
  });
});
