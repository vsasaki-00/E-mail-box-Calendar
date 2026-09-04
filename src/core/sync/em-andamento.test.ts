import { beforeEach, describe, expect, it } from 'vitest';
import { estaOcupado, sair, tentarEntrar, VALIDADE_MS } from './em-andamento';

describe('em-andamento', () => {
  beforeEach(() => sair());

  it('o segundo ciclo nao entra enquanto o primeiro nao sai', () => {
    expect(tentarEntrar()).toBe(true);
    expect(tentarEntrar()).toBe(false);
    sair();
    expect(tentarEntrar()).toBe(true);
  });

  it('sair sem ter entrado nao trava nada', () => {
    sair();
    sair();
    expect(estaOcupado()).toBe(false);
    expect(tentarEntrar()).toBe(true);
  });

  it('trava abandonada EXPIRA — instancia congelada nao pode travar para sempre', () => {
    // Numa funcao serverless a instancia pode ser congelada a qualquer
    // momento. Se isso acontecer com a trava tomada, o `finally` nunca roda.
    // Sem validade, aquela instancia recusaria todo sync para sempre: o
    // conserto viraria pane permanente.
    const t0 = 1_000_000;
    expect(tentarEntrar(t0)).toBe(true);
    expect(tentarEntrar(t0 + VALIDADE_MS - 1)).toBe(false);
    expect(tentarEntrar(t0 + VALIDADE_MS)).toBe(true);
  });

  it('a validade e maior que o teto da plataforma', () => {
    // Se fosse menor, uma execucao VIVA seria considerada abandonada e duas
    // rodariam juntas — exatamente o que a trava existe para impedir.
    expect(VALIDADE_MS).toBeGreaterThan(60_000);
  });
});
