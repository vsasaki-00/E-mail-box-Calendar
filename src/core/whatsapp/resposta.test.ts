import { describe, expect, it } from 'vitest';
import { montarResposta, type ContextoResposta } from './resposta';

/**
 * O `Intl` separa "R$" do numero com espaco NAO-QUEBRAVEL (U+00A0), de
 * proposito — e certo, o valor nao deve quebrar de linha no meio. Os testes
 * comparam com espaco comum, entao normalizam aqui em vez de o codigo
 * piorar a formatacao para caber no teste.
 */
const txt = (ctx: ContextoResposta, tz?: string) =>
  (montarResposta(ctx, tz) ?? '').replace(/\u00a0/g, ' ');

const BASE: ContextoResposta = {
  amountCents: 120000,
  direcao: 'SAIDA',
  descricao: 'fornecedor XYZ',
  data: new Date('2026-08-15T12:00:00Z'),
  confianca: 0.7,
  outrasPendentes: 0,
};

describe('montarResposta', () => {
  it('fecha o laco: diz o que entendeu, com valor, descricao e data', () => {
    const t = txt(BASE);
    expect(t).toContain('Entendi: saída de R$ 1.200,00');
    expect(t).toContain('fornecedor XYZ');
    expect(t).toContain('15/08');
  });

  it('separa entrada de saida', () => {
    expect(txt({ ...BASE, direcao: 'ENTRADA' })).toContain('Entendi: entrada de');
  });

  it('sempre diz que NADA foi lancado — o app nunca lanca sozinho', () => {
    expect(txt(BASE)).toContain('Nada foi lançado ainda');
  });

  it('sem valor, a resposta e o aviso — e traz exemplo', () => {
    // Sem esta resposta voce acha que deu certo e a despesa some.
    const t = txt({ ...BASE, amountCents: undefined, motivoFalha: 'mídia sem legenda' });
    expect(t).toContain('Não consegui ler um valor.');
    expect(t).toContain('mídia sem legenda');
    // Sem repetir a mesma ideia duas vezes na mesma mensagem.
    expect(t).not.toContain('valor: ');
    expect(t).toContain('paguei o fornecedor XYZ, 1.200');
    // Nao promete confirmacao no painel de algo que nao virou proposta.
    expect(t).not.toContain('Confirme no painel');
  });

  it('valor zero ou negativo cai no mesmo aviso', () => {
    expect(txt({ ...BASE, amountCents: 0 })).toContain('Não consegui ler');
  });

  it('confianca baixa e declarada, nao escondida', () => {
    expect(txt({ ...BASE, confianca: 0.5 })).toContain('Leitura incerta');
    expect(txt({ ...BASE, confianca: 0.9 })).not.toContain('Leitura incerta');
  });

  it('avisa do parecido ANTES do dinheiro sair de novo', () => {
    const t = txt({
      ...BASE,
      parecido: { quando: new Date('2026-08-02T12:00:00Z'), descricao: 'FORNECEDOR XYZ LTDA' },
    });
    expect(t).toContain('Parecido com');
    expect(t).toContain('FORNECEDOR XYZ LTDA');
    expect(t).toContain('02/08');
  });

  it('sem parecido, nao inventa aviso', () => {
    expect(txt(BASE)).not.toContain('Parecido com');
  });

  it('traz o que vence — a informacao que so este app tem', () => {
    const t = txt({ ...BASE, aVencer: { quantas: 3, totalCents: 420000, dias: 7 } });
    expect(t).toContain('A vencer em 7 dias: R$ 4.200,00 em 3 cobranças');
  });

  it('uma cobranca so nao vira "1 cobranças"', () => {
    expect(txt({ ...BASE, aVencer: { quantas: 1, totalCents: 5000, dias: 7 } })).toContain('1 cobrança.');
  });

  it('zero a vencer nao gera linha', () => {
    expect(txt({ ...BASE, aVencer: { quantas: 0, totalCents: 0, dias: 7 } })).not.toContain('A vencer');
  });

  it('conta as outras pendentes, com plural certo', () => {
    expect(txt({ ...BASE, outrasPendentes: 1 })).toContain('há mais 1 esperando');
    expect(txt({ ...BASE, outrasPendentes: 4 })).toContain('há mais 4 esperando');
    expect(txt(BASE)).not.toContain('esperando');
  });

  it('a data sai no fuso do dono, nao no do servidor', () => {
    // 15/08 as 02:00 UTC ainda e 14/08 em Sao Paulo. Sem fuso explicito, a
    // resposta contradiria a tela.
    const t = txt({ ...BASE, data: new Date('2026-08-15T02:00:00Z') }, 'America/Sao_Paulo');
    expect(t).toContain('14/08');
  });

  it('cabe numa conversa: curta', () => {
    const cheia = txt({
      ...BASE,
      confianca: 0.4,
      parecido: { quando: new Date('2026-08-02T12:00:00Z'), descricao: 'FORNECEDOR XYZ LTDA' },
      aVencer: { quantas: 3, totalCents: 420000, dias: 7 },
      outrasPendentes: 2,
    });
    expect(cheia.length).toBeLessThan(420);
  });
});
