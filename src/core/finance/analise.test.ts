import { describe, expect, it } from 'vitest';
import {
  fluxoMensal,
  fluxoPorNegocio,
  previsibilidade,
  recorrentes,
  saidasPorCategoria,
  torneiras,
  ultimosMeses,
  type LancamentoAnalise,
} from './analise';
import { normalizarDescricao } from './extrato/normalizar';

const TZ = 'America/Sao_Paulo';

function l(p: {
  dia: string;
  valor: number;
  desc: string;
  cat?: string | null;
  neg?: string | null;
  conta?: string;
}): LancamentoAnalise {
  return {
    postedAt: new Date(`${p.dia}T15:00:00Z`),
    amountCents: p.valor,
    category: p.cat ?? null,
    business: p.neg ?? null,
    description: p.desc,
    normalized: normalizarDescricao(p.desc),
    accountId: p.conta ?? 'a1',
    accountLabel: p.conta ?? 'Nubank',
  };
}

describe('ultimosMeses', () => {
  it('conta para tras cruzando o ano, no fuso', () => {
    // 31/12 23h em SP ainda e dezembro; em UTC ja e janeiro.
    expect(ultimosMeses(new Date('2027-01-01T02:00:00Z'), TZ, 3)).toEqual(['2026-10', '2026-11', '2026-12']);
  });
});

describe('fluxoMensal', () => {
  const meses = ['2026-07', '2026-08'];
  it('soma entradas e saidas por mes, com zero onde nao ha nada', () => {
    const f = fluxoMensal(
      [l({ dia: '2026-08-05', valor: 1000, desc: 'x' }), l({ dia: '2026-08-06', valor: -400, desc: 'y' })],
      TZ,
      meses,
    );
    expect(f).toEqual([
      { mes: '2026-07', entradas: 0, saidas: 0, liquido: 0 },
      { mes: '2026-08', entradas: 1000, saidas: -400, liquido: 600 },
    ]);
  });
  it('transferencia entre contas nao e entrada nem saida', () => {
    const f = fluxoMensal([l({ dia: '2026-08-05', valor: -5000, desc: 't', cat: 'Transferência entre contas' })], TZ, meses);
    expect(f[1]?.saidas).toBe(0);
  });
  it('31/08 23h em SP e agosto', () => {
    const f = fluxoMensal([{ ...l({ dia: '2026-08-31', valor: -100, desc: 'z' }), postedAt: new Date('2026-09-01T02:00:00Z') }], TZ, meses);
    expect(f[1]?.saidas).toBe(-100);
  });
});

describe('fluxoPorNegocio', () => {
  it('separa por negocio e ordena pelo maior movimento', () => {
    const r = fluxoPorNegocio(
      [
        l({ dia: '2026-08-01', valor: 100, desc: 'a', neg: 'Pessoais' }),
        l({ dia: '2026-08-01', valor: 90000, desc: 'b', neg: 'Unitedcom' }),
        l({ dia: '2026-08-01', valor: -50, desc: 'c' }),
      ],
      TZ,
      ['2026-08'],
    );
    expect(r.map((x) => x.negocio)).toEqual(['Unitedcom', 'Pessoais', '(sem negócio)']);
  });

  it('negocio so com transferencia entre contas nao vira linha de zeros', () => {
    const r = fluxoPorNegocio(
      [
        l({ dia: '2026-08-01', valor: 100, desc: 'a', neg: 'Pessoais' }),
        l({ dia: '2026-08-01', valor: -5000, desc: 't', cat: 'Transferência entre contas' }),
      ],
      TZ,
      ['2026-08'],
    );
    expect(r.map((x) => x.negocio)).toEqual(['Pessoais']);
  });
});

describe('saidasPorCategoria', () => {
  it('so saidas, maior primeiro, sem categoria agrupado', () => {
    const r = saidasPorCategoria([
      l({ dia: '2026-08-01', valor: -100, desc: 'a', cat: 'Saúde' }),
      l({ dia: '2026-08-01', valor: -900, desc: 'b' }),
      l({ dia: '2026-08-01', valor: 500, desc: 'c', cat: 'Receita' }),
    ]);
    expect(r).toEqual([
      { categoria: '(sem categoria)', total: -900, quantidade: 1 },
      { categoria: 'Saúde', total: -100, quantidade: 1 },
    ]);
  });
});

describe('recorrentes', () => {
  const netflix = (dia: string, valor = -5590) => l({ dia, valor, desc: 'NETFLIX.COM', cat: 'Assinaturas e software' });

  it('tres meses com a mesma chave = recorrente, com mediana e variacao', () => {
    const r = recorrentes([netflix('2026-06-10'), netflix('2026-07-10'), netflix('2026-08-10', -6590)], TZ);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ chave: 'netflix', meses: 3, mediana: -5590, ultimo: -6590, ultimoMes: '2026-08', saida: true });
    expect(r[0]?.variacao).toBeCloseTo(0.179, 2);
  });

  it('dois meses nao e recorrente', () => {
    expect(recorrentes([netflix('2026-07-10'), netflix('2026-08-10')], TZ)).toEqual([]);
  });

  it('dois pagamentos no mesmo mes somam antes de comparar', () => {
    const r = recorrentes([netflix('2026-06-10'), netflix('2026-07-10'), netflix('2026-08-10'), netflix('2026-08-20')], TZ);
    expect(r[0]?.ultimo).toBe(-11180);
    expect(r[0]?.meses).toBe(3);
  });

  it('a chave ignora a data embutida na descricao', () => {
    const r = recorrentes(
      [
        l({ dia: '2026-06-10', valor: -100, desc: 'COMPRA CARTAO 10/06 SUPERMERCADO X ****1234' }),
        l({ dia: '2026-07-10', valor: -100, desc: 'COMPRA CARTAO 10/07 SUPERMERCADO X ****1234' }),
        l({ dia: '2026-08-10', valor: -100, desc: 'COMPRA CARTAO 10/08 SUPERMERCADO X ****1234' }),
      ],
      TZ,
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.chave).toBe('supermercado');
  });
});

describe('torneiras', () => {
  const base = { exemplo: 'x', meses: 4, ultimoMes: '2026-08', saida: true, negocios: ['Unitedcom'] };
  it('aumentou: mais de 5% acima da mediana', () => {
    const t = torneiras([{ ...base, chave: 'netflix', categoria: 'Assinaturas e software', mediana: -5590, ultimo: -6590, variacao: 0.179, contas: ['Nubank'] }]);
    expect(t.map((x) => x.tipo)).toEqual(['aumentou']);
    expect(t[0]?.motivo).toMatch(/18% acima/);
  });
  it('duplicado em duas contas; sem categoria', () => {
    const t = torneiras([{ ...base, chave: 'spotify', categoria: null, mediana: -2190, ultimo: -2190, variacao: 0, contas: ['Nubank', 'Itaú'] }]);
    expect(t.map((x) => x.tipo).sort()).toEqual(['duplicado', 'sem-categoria']);
  });
  it('entrada que aumentou nao e torneira', () => {
    const t = torneiras([{ ...base, saida: false, chave: 'cliente', categoria: 'Receita', mediana: 100000, ultimo: 200000, variacao: 1, contas: ['Nubank'] }]);
    expect(t).toEqual([]);
  });
  it('ordena pelo que custa mais por mes', () => {
    const t = torneiras([
      { ...base, chave: 'a', categoria: null, mediana: -100, ultimo: -100, variacao: 0, contas: ['N'] },
      { ...base, chave: 'b', categoria: null, mediana: -9000, ultimo: -9000, variacao: 0, contas: ['N'] },
    ]);
    expect(t.map((x) => x.recorrente.chave)).toEqual(['b', 'a']);
  });
});

describe('previsibilidade', () => {
  const fluxo = [
    { mes: '2026-06', entradas: 10000, saidas: -8000, liquido: 2000 },
    { mes: '2026-07', entradas: 10000, saidas: -8000, liquido: 2000 },
    { mes: '2026-08', entradas: 0, saidas: 0, liquido: 0 }, // sem dado: fora da media
  ];
  const recorrente = (p: Partial<Parameters<typeof previsibilidade>[1][number]> & { mediana: number; meses: number }) => ({
    chave: 'x', exemplo: '', categoria: null, ultimo: p.mediana, ultimoMes: '2026-07',
    variacao: 0, contas: [], negocios: [], saida: false, ...p,
  });

  it('fracao recorrente das entradas e cobertura das saidas', () => {
    const p = previsibilidade(fluxo, [recorrente({ mediana: 6000, meses: 2 })]);
    expect(p.mediaEntradas).toBe(10000);
    expect(p.fracaoRecorrente).toBe(0.6);
    expect(p.cobertura).toBe(1.25);
  });

  it('pondera pela frequencia: quem pagou em metade dos meses vale metade', () => {
    // Sem ponderar, dois recorrentes de 6000 somariam 12000 > media 10000 e
    // a tela diria "100% previsivel · R$ 12.000 de R$ 10.000".
    const p = previsibilidade(fluxo, [recorrente({ mediana: 6000, meses: 2 }), recorrente({ chave: 'y', mediana: 6000, meses: 1 })]);
    expect(p.recorrenteEntradas).toBe(6000 + 3000);
    expect(p.recorrenteEntradas).toBeLessThanOrEqual(p.mediaEntradas);
    expect(p.fracaoRecorrente).toBe(0.9);
  });
});
