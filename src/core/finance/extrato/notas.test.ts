import { describe, expect, it } from 'vitest';
import { casarNotas, textoDaColagem, type LinhaDoExtrato, type NotaEsperando } from './notas';

const dia = (d: number) => new Date(Date.UTC(2026, 7, d, 15, 0, 0));

const nota = (over: Partial<NotaEsperando> = {}): NotaEsperando => ({
  id: 'n1',
  amountCents: 120000,
  direcao: 'SAIDA',
  quando: dia(10),
  descricao: 'fornecedor XYZ',
  business: 'Unitedcom',
  ...over,
});

const linha = (over: Partial<LinhaDoExtrato> = {}): LinhaDoExtrato => ({
  id: 'l1',
  amountCents: -120000,
  postedAt: dia(12),
  ...over,
});

describe('casarNotas', () => {
  it('cola quando ha um casamento so, dos dois lados', () => {
    const [c] = casarNotas([nota()], [linha()]);
    expect(c).toMatchObject({ lancamentoId: 'l1', notaId: 'n1', business: 'Unitedcom' });
  });

  it('valor diferente nao cola', () => {
    expect(casarNotas([nota()], [linha({ amountCents: -119999 })])).toEqual([]);
  });

  it('SINAL diferente nao cola — saida nao casa com entrada', () => {
    // Sem esta checagem, um recebimento de R$ 1.200 colaria a nota de um
    // pagamento de R$ 1.200 na mesma semana.
    expect(casarNotas([nota({ direcao: 'SAIDA' })], [linha({ amountCents: 120000 })])).toEqual([]);
    expect(casarNotas([nota({ direcao: 'ENTRADA' })], [linha({ amountCents: -120000 })])).toEqual([]);
  });

  it('fora da janela nao cola', () => {
    expect(casarNotas([nota()], [linha({ postedAt: dia(25) })])).toEqual([]);
    // A folga existe porque compra no cartao cai na fatura dias depois.
    expect(casarNotas([nota()], [linha({ postedAt: dia(16) })])).toHaveLength(1);
  });

  it('a janela vale para os DOIS lados', () => {
    expect(casarNotas([nota({ quando: dia(12) })], [linha({ postedAt: dia(10) })])).toHaveLength(1);
  });

  it('DUAS linhas iguais deixam a nota esperando — nao sorteia', () => {
    // Duas compras de R$ 1.200 na mesma semana: colar a errada poria o
    // negocio errado num lancamento, em silencio.
    const r = casarNotas([nota()], [linha({ id: 'l1' }), linha({ id: 'l2', postedAt: dia(13) })]);
    expect(r).toEqual([]);
  });

  it('DUAS notas disputando a mesma linha tambem nao colam', () => {
    const r = casarNotas([nota({ id: 'n1' }), nota({ id: 'n2' })], [linha()]);
    expect(r).toEqual([]);
  });

  it('notas distintas para linhas distintas colam as duas', () => {
    const r = casarNotas(
      [nota({ id: 'n1', amountCents: 120000 }), nota({ id: 'n2', amountCents: 89900 })],
      [linha({ id: 'l1', amountCents: -120000 }), linha({ id: 'l2', amountCents: -89900 })],
    );
    expect(r.map((c) => [c.notaId, c.lancamentoId]).sort()).toEqual([
      ['n1', 'l1'],
      ['n2', 'l2'],
    ]);
  });

  it('leva categoria e descricao junto, nao so o negocio', () => {
    const [c] = casarNotas([nota({ category: 'Fornecedores' })], [linha()]);
    expect(c).toMatchObject({ category: 'Fornecedores', descricao: 'fornecedor XYZ' });
  });

  it('listas vazias nao explodem', () => {
    expect(casarNotas([], [linha()])).toEqual([]);
    expect(casarNotas([nota()], [])).toEqual([]);
  });
});

describe('textoDaColagem', () => {
  it('deixa o rastro de onde o significado veio', () => {
    expect(textoDaColagem('fornecedor XYZ', dia(10))).toBe('Nota de 10/08 pelo WhatsApp: fornecedor XYZ');
    expect(textoDaColagem(undefined, dia(10))).toBe('Nota de 10/08 pelo WhatsApp');
  });
});
