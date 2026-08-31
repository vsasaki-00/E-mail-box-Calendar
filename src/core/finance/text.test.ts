import { describe, expect, it } from 'vitest';
import { findAmounts, findDates, pickAmount, pickDueDate } from './text';

const HOJE = new Date('2026-08-31T12:00:00Z');

describe('findAmounts', () => {
  it('le as formas brasileiras de escrever dinheiro', () => {
    const achados = findAmounts('R$ 1.234,56 e R$ 89,90 e R$1.500');
    expect(achados.map((a) => a.cents)).toEqual([123456, 8990, 150000]);
  });

  it('ignora numero solto sem R$ e sem rotulo', () => {
    // Sem esta regra, ano, protocolo e numero de contrato viram dinheiro.
    expect(findAmounts('Contrato 2024 protocolo 987654 assinado.')).toEqual([]);
  });

  it('aceita numero sem R$ quando tem centavos E rotulo perto', () => {
    expect(findAmounts('Valor total: 1.209,90')[0]?.cents).toBe(120990);
  });
});

describe('pickAmount — qual dos valores é O valor', () => {
  it('pega o total, nao o primeiro item da lista', () => {
    const corpo = [
      'Item: assinatura mensal .......... R$ 89,90',
      'Item: usuários adicionais ......... R$ 120,00',
      'Valor total: R$ 1.209,90',
    ].join('\n');
    expect(pickAmount(corpo)?.cents).toBe(120990);
  });

  it('devolve null quando nao ha valor rotulado', () => {
    expect(pickAmount('Bom dia, tudo certo por aqui.')).toBeNull();
  });
});

describe('findDates', () => {
  it('le dd/mm/aaaa sempre como dia/mes', () => {
    // Nunca mm/dd: o sistema e para caixas brasileiras, e adivinhar a ordem
    // faria 03/04 virar duas datas diferentes conforme o e-mail.
    const [data] = findDates('Vencimento: 03/04/2026', HOJE);
    expect(data?.date.toISOString().slice(0, 10)).toBe('2026-04-03');
  });

  it('le data por extenso', () => {
    const [data] = findDates('Vence em 15 de setembro de 2026.', HOJE);
    expect(data?.date.toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('assume o ano corrente quando o e-mail so diz dia e mes', () => {
    const [data] = findDates('Vencimento: 15/09', HOJE);
    expect(data?.date.toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('descarta data impossivel', () => {
    expect(findDates('em 31/02/2026', HOJE)).toEqual([]);
  });

  it('guarda a data ao meio-dia UTC, nao a meia-noite', () => {
    // Meia-noite UTC vira o dia ANTERIOR em Brasilia (UTC-3), e o painel
    // diria que a conta venceu um dia antes do que venceu.
    const [data] = findDates('Vencimento: 15/09/2026', HOJE);
    expect(data?.date.getUTCHours()).toBe(12);
  });
});

describe('pickDueDate — qual das datas é o vencimento', () => {
  it('so aceita data com rotulo de vencimento perto', () => {
    const corpo = 'Contrato assinado em 03/04/2024.\nData de vencimento: 15/09/2026.';
    expect(pickDueDate(corpo, HOJE)?.date.toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('devolve null quando ha datas mas nenhuma e vencimento', () => {
    // Chutar a primeira data produziria um painel confiante e errado.
    expect(pickDueDate('Reunião em 12/10/2026, conforme combinado.', HOJE)).toBeNull();
  });

  it('prefere a data futura mais proxima entre varias rotuladas', () => {
    const corpo = 'Vencimento anterior: 10/07/2026. Novo vencimento: 20/09/2026.';
    expect(pickDueDate(corpo, HOJE)?.date.toISOString().slice(0, 10)).toBe('2026-09-20');
  });

  it('aceita vencimento ja passado quando e o unico rotulado', () => {
    // Conta vencida e exatamente o que o painel precisa mostrar.
    expect(pickDueDate('Vencimento: 10/07/2026', HOJE)?.date.toISOString().slice(0, 10)).toBe(
      '2026-07-10',
    );
  });
});
