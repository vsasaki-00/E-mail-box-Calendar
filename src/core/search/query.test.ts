import { describe, expect, it } from 'vitest';
import { isRunnable, MIN_QUERY_LENGTH, toTsQuery } from './query';

describe('toTsQuery', () => {
  it('transforma cada palavra em prefixo, unidas por AND', () => {
    // Prefixo importa: quem busca "fornec" espera achar "fornecedor". Sem
    // isso a busca so acha palavra inteira, e quase nunca acha.
    expect(toTsQuery('fornecedor boleto')).toBe('fornecedor:* & boleto:*');
    expect(toTsQuery('fornec')).toBe('fornec:*');
  });

  it('remove os caracteres que quebrariam a sintaxe do tsquery', () => {
    // Deixa-los passar trocaria "resultado vazio" por "erro do Postgres".
    expect(toTsQuery('R$ 100 & algo')).toBe('R$:* & 100:* & algo:*');
    expect(toTsQuery("a'b|c!d")).toBe('abcd:*');
  });

  it('devolve null quando nao sobra nada de util', () => {
    expect(toTsQuery('   ')).toBeNull();
    expect(toTsQuery('&|!')).toBeNull();
  });

  it('preserva acento', () => {
    expect(toTsQuery('cobrança')).toBe('cobrança:*');
  });
});

describe('isRunnable', () => {
  it('recusa termo curto demais', () => {
    // O pior resultado de uma busca e a lista inteira: parece resposta e
    // nao e.
    expect(isRunnable({ q: 'a' })).toBe(false);
    expect(isRunnable({ q: '   ' })).toBe(false);
  });

  it('aceita a partir do minimo', () => {
    expect(isRunnable({ q: 'ab' })).toBe(true);
    expect('ab'.length).toBe(MIN_QUERY_LENGTH);
  });
});
