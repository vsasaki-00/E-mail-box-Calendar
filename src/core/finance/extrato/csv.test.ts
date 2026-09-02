import { describe, expect, it } from 'vitest';
import { detectarSeparador, dividirLinha, lerCsv, lerDataCsv, lerValorCsv } from './csv';

/** Formatos que os bancos brasileiros exportam, um por teste. */

describe('lerValorCsv', () => {
  it('formato brasileiro e americano', () => {
    expect(lerValorCsv('1.234,56')).toBe(123456);
    expect(lerValorCsv('-1.234,56')).toBe(-123456);
    expect(lerValorCsv('1234.56')).toBe(123456);
    expect(lerValorCsv('R$ 89,90')).toBe(8990);
    expect(lerValorCsv('-R$ 89,90')).toBe(-8990);
  });
  it('convencoes de sinal: parenteses, sinal no fim, D/C', () => {
    expect(lerValorCsv('(1.234,56)')).toBe(-123456);
    expect(lerValorCsv('1.234,56-')).toBe(-123456);
    expect(lerValorCsv('1.234,56D')).toBe(-123456);
    expect(lerValorCsv('1.234,56C')).toBe(123456);
  });
  it('milhar sem decimal', () => {
    expect(lerValorCsv('1.234')).toBe(123400);
    expect(lerValorCsv('1,234')).toBe(123400);
    expect(lerValorCsv('12,5')).toBe(1250);
  });
  it('lixo vira undefined', () => {
    expect(lerValorCsv('')).toBeUndefined();
    expect(lerValorCsv('abc')).toBeUndefined();
    expect(lerValorCsv('15/08/2026')).toBeUndefined();
  });
});

describe('lerDataCsv', () => {
  it('dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd', () => {
    expect(lerDataCsv('15/08/2026')?.toISOString()).toBe('2026-08-15T15:00:00.000Z');
    expect(lerDataCsv('15/08/26')?.toISOString()).toBe('2026-08-15T15:00:00.000Z');
    expect(lerDataCsv('2026-08-15')?.toISOString()).toBe('2026-08-15T15:00:00.000Z');
    expect(lerDataCsv('15-08-2026')?.toISOString()).toBe('2026-08-15T15:00:00.000Z');
  });
  it('rejeita mes 13 e texto', () => {
    expect(lerDataCsv('15/13/2026')).toBeUndefined();
    expect(lerDataCsv('Saldo final')).toBeUndefined();
  });
});

describe('dividirLinha e detectarSeparador', () => {
  it('respeita aspas com o separador dentro', () => {
    expect(dividirLinha('15/08/2026;"LOJA; LTDA";"1.234,56"', ';')).toEqual([
      '15/08/2026',
      'LOJA; LTDA',
      '1.234,56',
    ]);
  });
  it('escolhe ; quando a virgula e decimal', () => {
    expect(detectarSeparador(['Data;Descrição;Valor', '15/08/2026;X;1.234,56', '16/08/2026;Y;-10,00'])).toBe(';');
  });
  it('escolhe , no formato Nubank', () => {
    expect(detectarSeparador(['date,category,title,amount', '2026-08-15,transporte,Uber,-23.90'])).toBe(',');
  });
});

describe('lerCsv — Itau/Inter (Data;Descrição;Valor)', () => {
  const csv = `Data;Descrição;Valor
15/08/2026;PIX ENVIADO FORNECEDOR XYZ;-1.234,56
20/08/2026;TED RECEBIDA CLIENTE ABC;5.000,00
`;
  const r = lerCsv(csv);
  it('le os dois com sinal', () => {
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0]).toMatchObject({ amountCents: -123456, description: 'PIX ENVIADO FORNECEDOR XYZ' });
    expect(r.lancamentos[1]).toMatchObject({ amountCents: 500000 });
  });
  it('sem FITID, sem aviso alem do esperado', () => {
    expect(r.lancamentos[0]?.fitId).toBeUndefined();
    expect(r.avisos).toEqual([]);
  });
  it('periodo vem dos proprios lancamentos', () => {
    expect(r.periodStart?.toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(r.periodEnd?.toISOString().slice(0, 10)).toBe('2026-08-20');
  });
});

describe('lerCsv — Nubank (date,category,title,amount)', () => {
  const csv = `date,category,title,amount
2026-08-15,transporte,Uber *Trip,-23.90
2026-08-16,serviços,Netflix,-55.90
`;
  const r = lerCsv(csv);
  it('le com decimal americano e data ISO', () => {
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0]).toMatchObject({ amountCents: -2390, description: 'Uber *Trip' });
  });
});

describe('lerCsv — Bradesco (Crédito e Débito separados, com Saldo)', () => {
  const csv = `Extrato de: Conta Corrente 1234-5
Período: 01/08/2026 a 31/08/2026

Data;Histórico;Docto.;Crédito (R$);Débito (R$);Saldo (R$)
15/08/2026;PAGTO BOLETO ENERGIA;000123;;250,00;10.000,00
20/08/2026;DEP DINHEIRO;000124;1.000,00;;11.000,00
;SALDO FINAL;;;;11.000,00
`;
  const r = lerCsv(csv);
  it('acha o cabecalho depois das linhas de titulo', () => {
    expect(r.lancamentos).toHaveLength(2);
  });
  it('debito vira negativo, credito positivo, saldo e ignorado', () => {
    expect(r.lancamentos[0]).toMatchObject({ amountCents: -25000, description: 'PAGTO BOLETO ENERGIA' });
    expect(r.lancamentos[1]).toMatchObject({ amountCents: 100000 });
  });
  it('a linha de saldo final vira aviso, nao lancamento', () => {
    expect(r.avisos.join(' ')).toMatch(/1 linha/);
  });
});

describe('lerCsv — sem cabecalho', () => {
  it('infere pela forma: data, numero, resto e descricao', () => {
    const r = lerCsv(`15/08/2026;COMPRA MERCADO;-45,90\n16/08/2026;SALARIO;3.000,00\n`);
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0]).toMatchObject({ amountCents: -4590, description: 'COMPRA MERCADO' });
    expect(r.avisos.join(' ')).toMatch(/inferidas/);
  });
  it('arquivo que nao e extrato diz o que esperava', () => {
    const r = lerCsv(`nome;idade\nAna;30\n`);
    expect(r.lancamentos).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/Data, Descrição/);
  });
});
