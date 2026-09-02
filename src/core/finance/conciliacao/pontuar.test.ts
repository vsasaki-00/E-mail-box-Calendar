import { describe, expect, it } from 'vitest';
import { CONFIANCA_MINIMA, escolherPares, pontuarPar, type CobrancaParaConciliar, type LancamentoParaConciliar } from './pontuar';
import { normalizarDescricao } from '../extrato/normalizar';

function lanc(p: { id?: string; amountCents: number; description: string; postedAt: string }): LancamentoParaConciliar {
  return {
    id: p.id ?? 'l1',
    postedAt: new Date(p.postedAt),
    amountCents: p.amountCents,
    description: p.description,
    normalized: normalizarDescricao(p.description),
  };
}
function cob(p: Partial<CobrancaParaConciliar> & { amountCents: number }): CobrancaParaConciliar {
  return {
    id: p.id ?? 'c1',
    amountCents: p.amountCents,
    // `null` explicito significa "sem vencimento"; ausente usa o padrao.
    dueDate: 'dueDate' in p ? (p.dueDate ?? null) : new Date('2026-08-15T15:00:00Z'),
    receivedAt: p.receivedAt ?? new Date('2026-08-05T12:00:00Z'),
    payee: p.payee ?? null,
    kind: p.kind ?? 'BOLETO',
  };
}

describe('pontuarPar', () => {
  it('valor igual, no dia, nome batendo, tipo combinando = confianca maxima', () => {
    const p = pontuarPar(
      lanc({ amountCents: -175204, description: 'Pagamento de boleto efetuado PORTO SEGURO SAUDE SA', postedAt: '2026-08-15T15:00:00Z' }),
      cob({ amountCents: 175204, payee: 'Porto Seguro Saúde S.A.' }),
    );
    expect(p.confianca).toBe(1);
    expect(p.motivo).toMatch(/valor igual/);
    expect(p.motivo).toMatch(/nome bate/);
    expect(p.motivo).toMatch(/tipo combina/);
  });

  it('valor diferente e zero, nao importa o resto', () => {
    const p = pontuarPar(
      lanc({ amountCents: -100000, description: 'PORTO SEGURO', postedAt: '2026-08-15T15:00:00Z' }),
      cob({ amountCents: 175204, payee: 'Porto Seguro' }),
    );
    expect(p.confianca).toBe(0);
    expect(p.motivo).toBe('valor diferente');
  });

  it('juros pequenos nao derrubam, e o motivo diz', () => {
    const p = pontuarPar(
      lanc({ amountCents: -176000, description: 'Pagamento de boleto PORTO SEGURO', postedAt: '2026-08-20T15:00:00Z' }),
      cob({ amountCents: 175204, payee: 'Porto Seguro' }),
    );
    expect(p.confianca).toBeGreaterThan(CONFIANCA_MINIMA);
    expect(p.motivo).toMatch(/acima \(juros\?\)/);
    expect(p.motivo).toMatch(/5 dias depois do vencimento/);
  });

  it('pagamento 60 dias depois do vencimento nao e este pagamento', () => {
    const p = pontuarPar(
      lanc({ amountCents: -175204, description: 'PORTO SEGURO', postedAt: '2026-10-15T15:00:00Z' }),
      cob({ amountCents: 175204, payee: 'Porto Seguro' }),
    );
    expect(p.confianca).toBe(0);
    expect(p.motivo).toMatch(/61 dias depois/);
  });

  it('valor igual + data certa sem nome ainda passa do minimo; so valor igual, nao', () => {
    const comData = pontuarPar(
      lanc({ amountCents: -5990, description: 'Transferência enviada pelo Pix FULANO', postedAt: '2026-08-15T15:00:00Z' }),
      cob({ amountCents: 5990, payee: 'Netflix' }),
    );
    expect(comData.confianca).toBeGreaterThanOrEqual(CONFIANCA_MINIMA);
    // 26 dias depois do vencimento, sem nome: e chute.
    const soValor = pontuarPar(
      lanc({ amountCents: -5990, description: 'X', postedAt: '2026-09-10T15:00:00Z' }),
      cob({ amountCents: 5990, payee: 'Netflix' }),
    );
    expect(soValor.confianca).toBeLessThan(CONFIANCA_MINIMA);
  });

  it('sem vencimento, usa a data do e-mail', () => {
    const p = pontuarPar(
      lanc({ amountCents: -5990, description: 'NETFLIX', postedAt: '2026-08-06T15:00:00Z' }),
      cob({ amountCents: 5990, dueDate: null, payee: 'Netflix', kind: 'ASSINATURA' }),
    );
    expect(p.motivo).toMatch(/do e-mail/);
    expect(p.confianca).toBeGreaterThan(CONFIANCA_MINIMA);
  });

  it('nome parcial diz quais palavras bateram', () => {
    const p = pontuarPar(
      lanc({ amountCents: -10000, description: 'PIX ENVIADO CLINICA SAO LUCAS LTDA', postedAt: '2026-08-15T15:00:00Z' }),
      cob({ amountCents: 10000, payee: 'Clínica São Lucas Odontologia', kind: 'PIX' }),
    );
    expect(p.motivo).toMatch(/nome parcial \(clinica sao lucas\)/);
  });
});

describe('escolherPares', () => {
  it('cada lado entra uma vez, o melhor par primeiro', () => {
    const l1 = lanc({ id: 'l1', amountCents: -5990, description: 'Pagamento de boleto NETFLIX', postedAt: '2026-08-15T15:00:00Z' });
    const l2 = lanc({ id: 'l2', amountCents: -5990, description: 'PIX ENVIADO ALGUEM', postedAt: '2026-08-16T15:00:00Z' });
    const c1 = cob({ id: 'c1', amountCents: 5990, payee: 'Netflix' });
    const pares = escolherPares([l1, l2], [c1]);
    // Dois lancamentos de 59,90 para uma cobranca: fica o que tem nome.
    expect(pares).toHaveLength(1);
    expect(pares[0]).toMatchObject({ lancamentoId: 'l1', cobrancaId: 'c1' });
  });

  it('abaixo do minimo nao sugere', () => {
    const l = lanc({ amountCents: -5990, description: 'X', postedAt: '2026-09-12T15:00:00Z' });
    expect(escolherPares([l], [cob({ amountCents: 5990 })])).toEqual([]);
  });
});
