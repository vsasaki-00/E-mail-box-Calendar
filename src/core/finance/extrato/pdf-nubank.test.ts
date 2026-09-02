import { describe, expect, it } from 'vitest';
import { lerExtratoNubankPdf, pareceExtratoNubank } from './pdf-nubank';

/**
 * Texto no formato que o pdfjs devolve do extrato do Nubank — valores e
 * nomes ficticios, estrutura real: cabecalho repetido por pagina, quebra de
 * pagina NO MEIO de um lancamento, valor ora em linha propria ora no fim
 * da descricao, dia com entradas e saidas.
 */
const CABECALHO = `EMPRESA EXEMPLO DE SERVICOS
LTDA
12.345.678/0001-90 0001CNPJ Agência Conta
123456789-0
a01 DE JANEIRO DE 2026 02 DE SETEMBRO DE 2026 VALORES EM R$`;

const RODAPE = (p: number) => `Tem alguma dúvida? Mande uma mensagem para nosso time de atendimento pelo chat do app ou ligue 4020 0185 (capitais e regiões
metropolitanas) ou 0800 591 2117 (demais localidades). Atendimento 24h.
Caso a solução fornecida nos canais de atendimento não tenha sido satisfatória, fale com a Ouvidoria em 0800 887 0463 ou pelos meios
disponíveis em nubank.com.br/contatos#ouvidoria . Atendimento das 8h às 18h em dias úteis.
Extrato gerado dia 02 de setembro de 2026 às 17:24 ${p} de 2`;

const TEXTO = `${CABECALHO}
Saldo final do período
R$ 643,79
Saldo inicial
Rendimento líquido
Total de entradas
Total de saídas
Saldo final do período
0,00
+0,00
+16.100,00
-15.456,21
643,79
Movimentações
06 JAN 2026 Total de entradas + 1.800,00
Transferência Recebida Fulano de Tal - •••.443.238-•• -
NU PAGAMENTOS - IP (0260) Agência: 1 Conta:
9230604-5
1.800,00
Total de saídas - 1.752,04
Pagamento de boleto efetuado SEGURADORA EXEMPLO SA 1.752,04
Saldo do dia 47,96
07 JAN 2026 Total de saídas - 12.547,96
Transferência enviada pelo Pix Fulano de Tal - •••.443.238-•• -
BCO EXEMPLO S.A. (0336) Agência: 1 Conta: 1596521-0
12.547,96
Total de entradas + 14.300,00
Transferência recebida pelo Pix CLIENTE EXEMPLO S.A. - 51.300.867/0001-01 -
FITBANK IP (0450) Agência: 1 Conta: 5301577114-1
12.500,00
Transferência recebida pelo Pix CLIENTE EXEMPLO S.A. - 51.300.867/0001-01 -
FITBANK IP (0450) Agência: 1 Conta: 5301577114-1
1.800,00
Saldo do dia 1.800,00
08 JAN 2026 Total de saídas - 1.156,21
${RODAPE(1)}
${CABECALHO}
Transferência enviada pelo Pix Fulano de Tal - •••.443.238-•• -
BCO EXEMPLO S.A. (0336) Agência: 1 Conta: 1596521-0
1.156,21
Saldo do dia 643,79
2 de 2
${CABECALHO}
O saldo líquido corresponde ao total de depósitos e rendimentos em conta, não considerando movimentações feitas após.
Não nos responsabilizamos pelo uso indevido ou por alterações das informações originalmente contidas neste documento.
Asseguramos a autenticidade destas movimentações e das informações aqui citadas.
Nu Pagamentos S.A. - Instituição de Pagamento
CNPJ: 18.236.120/0001-58
${RODAPE(2)}`;

describe('pareceExtratoNubank', () => {
  it('reconhece pelo conteudo', () => {
    expect(pareceExtratoNubank(TEXTO)).toBe(true);
    expect(pareceExtratoNubank('FATURA\nTotal a pagar R$ 100,00')).toBe(false);
  });
});

describe('lerExtratoNubankPdf', () => {
  const r = lerExtratoNubankPdf(TEXTO);

  it('le todos os lancamentos, inclusive o que quebrou de pagina', () => {
    expect(r.lancamentos).toHaveLength(6);
  });

  it('sinal vem do bloco (entradas +, saidas -), em qualquer ordem no dia', () => {
    const valores = r.lancamentos.map((l) => l.amountCents);
    expect(valores).toEqual([180000, -175204, -1254796, 1250000, 180000, -115621]);
  });

  it('valor no fim da linha da descricao tambem e lancamento', () => {
    expect(r.lancamentos[1]).toMatchObject({
      amountCents: -175204,
      description: 'Pagamento de boleto efetuado SEGURADORA EXEMPLO SA',
    });
  });

  it('descricao em tres linhas vira uma, e o cabecalho no meio nao entra nela', () => {
    expect(r.lancamentos[0]?.description).toBe(
      'Transferência Recebida Fulano de Tal - •••.443.238-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 9230604-5',
    );
    const quebrado = r.lancamentos[5]!;
    expect(quebrado.description).not.toMatch(/EMPRESA EXEMPLO|VALORES EM|Extrato gerado|de 2/);
    expect(quebrado.description).toMatch(/^Transferência enviada pelo Pix/);
  });

  it('datas certas, ao meio-dia de Brasilia', () => {
    expect(r.lancamentos[0]?.postedAt.toISOString()).toBe('2026-01-06T15:00:00.000Z');
    expect(r.lancamentos[5]?.postedAt.toISOString()).toBe('2026-01-08T15:00:00.000Z');
  });

  it('"Saldo do dia" e os totais nao viram lancamento', () => {
    expect(r.lancamentos.some((l) => /Saldo|Total/.test(l.description))).toBe(false);
  });

  it('conta, banco, saldo e periodo vem do cabecalho', () => {
    expect(r.conta).toMatchObject({
      bankId: '0260',
      accountId: '0001/123456789-0',
      kind: 'CHECKING',
      balanceCents: 64379,
    });
    expect(r.periodStart?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(r.periodEnd?.toISOString().slice(0, 10)).toBe('2026-09-02');
    expect(r.conta.balanceAt).toEqual(r.periodEnd);
  });

  it('sem FITID, sem avisos quando tudo foi lido', () => {
    expect(r.lancamentos.every((l) => l.fitId === undefined)).toBe(true);
    expect(r.avisos).toEqual([]);
  });

  it('a soma bate com o resumo do extrato', () => {
    const entradas = r.lancamentos.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
    const saidas = r.lancamentos.filter((l) => l.amountCents < 0).reduce((s, l) => s + l.amountCents, 0);
    expect(entradas).toBe(1610000);
    expect(saidas).toBe(-1545621);
  });

  it('rabo de descricao orfao depois da quebra de pagina volta para o lancamento certo', () => {
    // O valor veio ANTES da quebra; o fim da descricao (banco/conta), depois.
    const texto = `${CABECALHO}
Movimentações
10 FEV 2026 Total de entradas + 59,90
Transferência recebida pelo Pix ALGUEM - •••.111.222-
59,90
${RODAPE(1)}
${CABECALHO}
•• - BCO EXEMPLO S.A. (0336) Agência: 1 Conta: 1596521-
0
Total de saídas - 10,00
Pagamento de boleto efetuado X 10,00
Saldo do dia 49,90
O saldo líquido corresponde ao total`;
    const r = lerExtratoNubankPdf(texto);
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0]?.description).toBe(
      'Transferência recebida pelo Pix ALGUEM - •••.111.222- •• - BCO EXEMPLO S.A. (0336) Agência: 1 Conta: 1596521- 0',
    );
    expect(r.lancamentos[0]?.amountCents).toBe(5990);
    expect(r.avisos.join(' ')).toMatch(/remontadas/);
    expect(r.avisos.join(' ')).not.toMatch(/ignorados/);
  });

  it('PDF sem "Movimentações" avisa em vez de explodir', () => {
    const vazio = lerExtratoNubankPdf('qualquer coisa');
    expect(vazio.lancamentos).toEqual([]);
    expect(vazio.avisos[0]).toMatch(/Movimentações/);
  });
});
