import { describe, expect, it } from 'vitest';
import { interpretarTexto } from './mensagem';

const AGORA = new Date('2026-09-02T15:00:00Z');

describe('interpretarTexto — valor', () => {
  it('formatos que uma pessoa digita', () => {
    expect(interpretarTexto('paguei o fornecedor X, 1.200', AGORA).amountCents).toBe(120000);
    expect(interpretarTexto('paguei 1.234,56', AGORA).amountCents).toBe(123456);
    expect(interpretarTexto('gastei R$ 89,90 no mercado', AGORA).amountCents).toBe(8990);
    expect(interpretarTexto('paguei 89,90', AGORA).amountCents).toBe(8990);
    expect(interpretarTexto('recebi 1200', AGORA).amountCents).toBe(120000);
  });

  it('"1,2k" e "2 mil"', () => {
    expect(interpretarTexto('paguei 1,2k de aluguel', AGORA).amountCents).toBe(120000);
    expect(interpretarTexto('recebi 2 mil do cliente', AGORA).amountCents).toBe(200000);
  });

  it('a data na frase nao vira valor', () => {
    const p = interpretarTexto('paguei 1.200 dia 15/08', AGORA);
    expect(p.amountCents).toBe(120000);
  });

  it('ano solto nao vira valor', () => {
    expect(interpretarTexto('nota fiscal 2026 paguei 300', AGORA).amountCents).toBe(30000);
  });

  it('sem valor, confianca baixa e proposta sem numero', () => {
    const p = interpretarTexto('paguei o fornecedor', AGORA);
    expect(p.amountCents).toBeUndefined();
    expect(p.confianca).toBeLessThan(0.3);
    expect(p.motivo).toMatch(/sem valor/);
  });
});

describe('interpretarTexto — direcao', () => {
  it('verbo de saida e de entrada', () => {
    expect(interpretarTexto('paguei 100', AGORA).direcao).toBe('SAIDA');
    expect(interpretarTexto('gastei 100', AGORA).direcao).toBe('SAIDA');
    expect(interpretarTexto('recebi 100', AGORA).direcao).toBe('ENTRADA');
    expect(interpretarTexto('caiu 100 na conta', AGORA).direcao).toBe('ENTRADA');
  });

  it('sem verbo assume saida, e diz que assumiu', () => {
    const p = interpretarTexto('fornecedor ACME 349', AGORA);
    expect(p.direcao).toBe('SAIDA');
    expect(p.motivo).toMatch(/assumido saída/);
    expect(p.confianca).toBe(0.5);
  });
});

describe('interpretarTexto — data', () => {
  it('hoje, ontem, anteontem', () => {
    expect(interpretarTexto('paguei 100 hoje', AGORA).data?.toISOString()).toBe('2026-09-02T15:00:00.000Z');
    expect(interpretarTexto('paguei 100 ontem', AGORA).data?.toISOString()).toBe('2026-09-01T15:00:00.000Z');
    expect(interpretarTexto('paguei 100 anteontem', AGORA).data?.toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });

  it('dd/mm e dd/mm/aa, ao meio-dia de Brasilia', () => {
    expect(interpretarTexto('paguei 100 em 15/08', AGORA).data?.toISOString()).toBe('2026-08-15T15:00:00.000Z');
    expect(interpretarTexto('paguei 100 em 15/08/25', AGORA).data?.toISOString()).toBe('2025-08-15T15:00:00.000Z');
  });

  it('data impossivel e ignorada', () => {
    expect(interpretarTexto('paguei 100 em 31/02', AGORA).data).toBeUndefined();
  });

  it('sem data, fica indefinida — quem chama usa a chegada da mensagem', () => {
    expect(interpretarTexto('paguei 100', AGORA).data).toBeUndefined();
  });
});

describe('interpretarTexto — descricao', () => {
  it('sobra quem, sem o valor, a data e os verbos', () => {
    expect(interpretarTexto('paguei o fornecedor XYZ, 1.200 dia 15/08', AGORA).descricao).toBe('fornecedor XYZ');
    expect(interpretarTexto('recebi 2 mil do cliente ACME', AGORA).descricao).toBe('cliente ACME');
    expect(interpretarTexto('gastei R$ 89,90 no mercado', AGORA).descricao).toBe('mercado');
  });

  it('frase que e so valor nao inventa descricao', () => {
    expect(interpretarTexto('paguei 100', AGORA).descricao).toBe('(sem descrição)');
  });
});
