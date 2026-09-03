import { describe, expect, it } from 'vitest';
import {
  ciclosPorDia,
  diasSemCiclo,
  duracaoMs,
  ehOrfa,
  emAndamento,
  formatarDuracao,
  MINIMO_PARA_P95,
  percentil,
  resumirPorProvedor,
  resumirPorRecurso,
  serieDeDias,
  totalizar,
  type CorridaBruta,
} from './saude';

const AGORA = new Date('2026-09-03T12:00:00Z');

function corrida(over: Partial<CorridaBruta> = {}): CorridaBruta {
  return {
    connectionId: 'c1',
    provider: 'GOOGLE',
    conta: 'dono@unitedcom.com',
    resource: 'MAIL',
    startedAt: new Date('2026-09-03T11:00:00Z'),
    finishedAt: new Date('2026-09-03T11:00:02Z'),
    outcome: 'SUCCESS',
    itens: 3,
    errorMessage: null,
    ...over,
  };
}

describe('corrida orfa — o processo que morreu no meio', () => {
  it('aberta ha muito tempo e orfa, nao "rodando"', () => {
    const morta = corrida({ startedAt: new Date('2026-09-03T10:00:00Z'), finishedAt: null, outcome: null });
    expect(ehOrfa(morta, AGORA)).toBe(true);
    expect(emAndamento(morta, AGORA)).toBe(false);
  });

  it('aberta ha pouco e "rodando", nao orfa', () => {
    const viva = corrida({ startedAt: new Date('2026-09-03T11:59:00Z'), finishedAt: null, outcome: null });
    expect(ehOrfa(viva, AGORA)).toBe(false);
    expect(emAndamento(viva, AGORA)).toBe(true);
  });

  it('corrida fechada nunca e orfa, por mais antiga que seja', () => {
    expect(ehOrfa(corrida({ startedAt: new Date('2020-01-01T00:00:00Z') }), AGORA)).toBe(false);
  });

  it('orfa NAO entra na duracao — senao um dia sem nada terminar pareceria rapido', () => {
    const resumo = resumirPorProvedor(
      [
        corrida({ finishedAt: new Date('2026-09-03T11:00:02Z') }),
        corrida({ startedAt: new Date('2026-09-03T09:00:00Z'), finishedAt: null, outcome: null }),
      ],
      AGORA,
    )[0]!;

    expect(resumo.total).toBe(2);
    expect(resumo.orfas).toBe(1);
    expect(resumo.amostraDuracao).toBe(1);
    expect(resumo.p50Ms).toBe(2000);
    // Nao contabilizada como sucesso nem como falha: ninguem sabe o que ela era.
    expect(resumo.sucesso).toBe(1);
    expect(resumo.falha).toBe(0);
  });
});

describe('duracaoMs', () => {
  it('mede o fechado e ignora o aberto', () => {
    expect(duracaoMs(corrida())).toBe(2000);
    expect(duracaoMs(corrida({ finishedAt: null }))).toBeUndefined();
  });

  it('descarta duracao negativa em vez de reportar -3s', () => {
    expect(duracaoMs(corrida({ finishedAt: new Date('2026-09-03T10:59:57Z') }))).toBeUndefined();
  });
});

describe('percentil', () => {
  it('posto mais proximo devolve um valor que existiu de verdade', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentil(v, 50)).toBe(50);
    expect(percentil(v, 95)).toBe(100);
    expect(percentil(v, 100)).toBe(100);
    // Nao interpola: 55 nunca aparece, porque nenhuma corrida durou 55.
    expect(v).toContain(percentil(v, 50));
  });

  it('nao depende da ordem de entrada', () => {
    expect(percentil([30, 10, 20], 50)).toBe(20);
  });

  it('lista vazia nao vira zero — vira ausencia', () => {
    expect(percentil([], 50)).toBeUndefined();
  });
});

describe('p95 so com amostra suficiente', () => {
  it('some quando ha poucas corridas', () => {
    const poucas = Array.from({ length: MINIMO_PARA_P95 - 1 }, () => corrida());
    const r = resumirPorProvedor(poucas, AGORA)[0]!;
    expect(r.p50Ms).toBe(2000);
    expect(r.p95Ms).toBeUndefined();
    expect(r.amostraDuracao).toBe(MINIMO_PARA_P95 - 1);
  });

  it('aparece a partir do minimo', () => {
    const bastantes = Array.from({ length: MINIMO_PARA_P95 }, () => corrida());
    expect(resumirPorProvedor(bastantes, AGORA)[0]!.p95Ms).toBe(2000);
  });
});

describe('resumirPorProvedor', () => {
  it('separa provedores e conta cada desfecho', () => {
    const resumos = resumirPorProvedor(
      [
        corrida({ outcome: 'SUCCESS' }),
        corrida({ outcome: 'PARTIAL' }),
        corrida({ outcome: 'FAILED', errorMessage: 'quota', itens: 0 }),
        corrida({ provider: 'MICROSOFT', connectionId: 'c2', conta: 'dono@cordex.ai' }),
      ],
      AGORA,
    );

    expect(resumos.map((r) => r.rotulo)).toEqual(['Google', 'Microsoft']);
    const google = resumos[0]!;
    expect(google).toMatchObject({ total: 3, sucesso: 1, parcial: 1, falha: 1, itens: 6 });
    expect(google.ultimoErro?.mensagem).toBe('quota');
  });

  it('mostra o erro MAIS RECENTE, nao o primeiro da lista', () => {
    const r = resumirPorProvedor(
      [
        corrida({ startedAt: new Date('2026-09-01T10:00:00Z'), outcome: 'FAILED', errorMessage: 'antigo' }),
        corrida({ startedAt: new Date('2026-09-03T10:00:00Z'), outcome: 'FAILED', errorMessage: 'recente' }),
      ],
      AGORA,
    )[0]!;
    expect(r.ultimoErro?.mensagem).toBe('recente');
  });
});

describe('resumirPorRecurso', () => {
  it('separa a mesma conta por recurso — o problema mora nessa granularidade', () => {
    const resumos = resumirPorRecurso(
      [corrida({ resource: 'MAIL' }), corrida({ resource: 'CALENDAR' })],
      AGORA,
    );
    expect(resumos.map((r) => r.rotulo).sort()).toEqual([
      'dono@unitedcom.com · agenda',
      'dono@unitedcom.com · e-mail',
    ]);
  });

  it('quem esta quebrado vem primeiro', () => {
    const resumos = resumirPorRecurso(
      [
        corrida({ connectionId: 'ok', conta: 'ok@x.com' }),
        corrida({ connectionId: 'ok', conta: 'ok@x.com' }),
        corrida({ connectionId: 'ruim', conta: 'ruim@x.com', outcome: 'FAILED', errorMessage: 'auth' }),
      ],
      AGORA,
    );
    expect(resumos[0]!.rotulo).toContain('ruim@x.com');
  });
});

describe('ciclosPorDia — voltas, nao corridas', () => {
  const volta = (iso: string, quantas = 12) =>
    Array.from({ length: quantas }, (_, i) =>
      corrida({ startedAt: new Date(new Date(iso).getTime() + i * 20_000), finishedAt: null, outcome: null }),
    );

  it('doze corridas seguidas sao UMA volta', () => {
    expect(ciclosPorDia(volta('2026-09-02T10:00:00Z'))).toEqual([{ dia: '2026-09-02', ciclos: 1 }]);
  });

  it('tres disparos do dia viram tres voltas', () => {
    const dia = [
      ...volta('2026-09-02T10:00:00Z'),
      ...volta('2026-09-02T16:00:00Z'),
      ...volta('2026-09-02T22:00:00Z'),
    ];
    expect(ciclosPorDia(dia)).toEqual([{ dia: '2026-09-02', ciclos: 3 }]);
  });

  it('conectar uma caixa nova nao inventa volta', () => {
    const seis = volta('2026-09-02T10:00:00Z', 6);
    const doze = volta('2026-09-02T10:00:00Z', 12);
    expect(ciclosPorDia(seis)).toEqual(ciclosPorDia(doze));
  });

  it('ordena por dia, mesmo com a entrada fora de ordem', () => {
    const fora = [...volta('2026-09-03T10:00:00Z', 2), ...volta('2026-09-01T10:00:00Z', 2)];
    expect(ciclosPorDia(fora).map((d) => d.dia)).toEqual(['2026-09-01', '2026-09-03']);
  });
});

describe('serieDeDias — o dia de zero PRECISA aparecer', () => {
  it('preenche o buraco com zero em vez de pular o dia', () => {
    const serie = serieDeDias(
      [
        { dia: '2026-09-01', ciclos: 3 },
        { dia: '2026-09-03', ciclos: 3 },
      ],
      new Date('2026-09-01T09:00:00Z'),
      new Date('2026-09-03T23:00:00Z'),
    );
    expect(serie.map((d) => [d.dia, d.ciclos])).toEqual([
      ['2026-09-01', 3],
      ['2026-09-02', 0],
      ['2026-09-03', 3],
    ]);
  });

  it('janela aberta a meia-noite: so o dia corrente e parcial', () => {
    const serie = serieDeDias([], new Date('2026-09-01T00:00:00Z'), new Date('2026-09-03T23:00:00Z'));
    expect(serie.map((d) => d.parcial)).toEqual([false, false, true]);
    expect(serie.map((d) => d.hoje)).toEqual([false, false, true]);
  });

  it('janela aberta no meio do dia: as DUAS pontas sao parciais', () => {
    // "7 dias atras" cai no meio de um dia, e as corridas da madrugada dele
    // ficaram fora da consulta. Cobrar 3 voltas desse dia acusaria de atraso
    // o que so esta cortado pela borda da janela.
    const serie = serieDeDias([], new Date('2026-09-01T09:30:00Z'), new Date('2026-09-03T09:30:00Z'));
    expect(serie.map((d) => d.parcial)).toEqual([true, false, true]);
    expect(serie.map((d) => d.hoje)).toEqual([false, false, true]);
  });

  it('o primeiro dia cortado nao vira buraco', () => {
    expect(
      diasSemCiclo([{ dia: '2026-09-02', ciclos: 3 }], new Date('2026-09-01T09:30:00Z'), new Date('2026-09-03T09:30:00Z')),
    ).toEqual([]);
  });
});

describe('diasSemCiclo — o buraco que nenhuma media mostra', () => {
  it('lista os dias inteiros sem nenhuma volta, e so eles', () => {
    const dias = [{ dia: '2026-09-02', ciclos: 3 }];
    // 31/08 abriu as 09:00 (ponta cortada) e 03/09 e o dia corrente: os dois
    // ficam de fora. Sobra 01/09, que passou inteiro dentro da janela sem
    // uma volta sequer.
    expect(diasSemCiclo(dias, new Date('2026-08-31T09:00:00Z'), new Date('2026-09-03T23:00:00Z'))).toEqual([
      '2026-09-01',
    ]);
  });

  it('periodo inteiro coberto nao acusa buraco', () => {
    const dias = [
      { dia: '2026-09-01', ciclos: 3 },
      { dia: '2026-09-02', ciclos: 3 },
    ];
    expect(diasSemCiclo(dias, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-02T23:59:00Z'))).toEqual([]);
  });

  it('o DIA CORRENTE nunca vira buraco — as 00h30 ele so nao rodou ainda', () => {
    // Sem esta regra o painel gritaria "dia sem volta" toda madrugada, e
    // um alarme que dispara todo dia ensina a ignorar alarmes.
    expect(diasSemCiclo([], new Date('2026-09-03T00:00:00Z'), new Date('2026-09-03T00:30:00Z'))).toEqual([]);
  });

  it('dia FECHADO com zero volta conta como buraco', () => {
    expect(
      diasSemCiclo([{ dia: '2026-09-01', ciclos: 0 }], new Date('2026-09-01T00:00:00Z'), new Date('2026-09-02T12:00:00Z')),
    ).toEqual(['2026-09-01']);
  });
});

describe('totalizar', () => {
  it('soma os grupos sem somar percentis (uma media de p50 nao e um p50)', () => {
    const total = totalizar(resumirPorProvedor([corrida(), corrida({ provider: 'MICROSOFT' })], AGORA));
    expect(total).toMatchObject({ total: 2, sucesso: 2, itens: 6, amostraDuracao: 2 });
    expect(total).not.toHaveProperty('p50Ms');
  });
});

describe('formatarDuracao', () => {
  it('escolhe a unidade que se le', () => {
    expect(formatarDuracao(340)).toBe('340ms');
    expect(formatarDuracao(1234)).toBe('1.2s');
    expect(formatarDuracao(45_000)).toBe('45.0s');
    expect(formatarDuracao(75_000)).toBe('1min 15s');
    expect(formatarDuracao(undefined)).toBe('—');
  });
});
