import { describe, expect, it } from 'vitest';
import { motivoParaPreservar, planejarExclusao, resumirPreservados, type LinhaParaDesfazer } from './desfazer';

const limpa = (over: Partial<LinhaParaDesfazer> = {}): LinhaParaDesfazer => ({
  id: 'a',
  categorySource: null,
  matchStatus: 'NONE',
  notes: null,
  ...over,
});

describe('motivoParaPreservar — a pergunta e "houve trabalho humano aqui?"', () => {
  it('linha intocada pode ir', () => {
    expect(motivoParaPreservar(limpa())).toBeUndefined();
  });

  it('categoria SUA preserva; palpite do app nao', () => {
    expect(motivoParaPreservar(limpa({ categorySource: 'USER' }))).toBe('você definiu a categoria');
    // Preservar palpite tornaria o desfazer inutil: quase toda linha e
    // categorizada por regra ou heuristica na importacao.
    expect(motivoParaPreservar(limpa({ categorySource: 'RULE' }))).toBeUndefined();
    expect(motivoParaPreservar(limpa({ categorySource: 'HEURISTIC' }))).toBeUndefined();
  });

  it('decisao de conciliacao preserva, nas duas direcoes', () => {
    expect(motivoParaPreservar(limpa({ matchStatus: 'CONFIRMED' }))).toContain('confirmou');
    expect(motivoParaPreservar(limpa({ matchStatus: 'REJECTED' }))).toContain('recusou');
    // SUGGESTED e o app propondo, nao voce decidindo.
    expect(motivoParaPreservar(limpa({ matchStatus: 'SUGGESTED' }))).toBeUndefined();
  });

  it('anotacao preserva, mas espaco em branco nao', () => {
    expect(motivoParaPreservar(limpa({ notes: 'combinei parcelar' }))).toBe('tem anotação sua');
    expect(motivoParaPreservar(limpa({ notes: '   ' }))).toBeUndefined();
  });
});

describe('planejarExclusao', () => {
  it('separa o que vai do que fica', () => {
    const plano = planejarExclusao([
      limpa({ id: '1' }),
      limpa({ id: '2', categorySource: 'USER' }),
      limpa({ id: '3' }),
      limpa({ id: '4', matchStatus: 'CONFIRMED' }),
    ]);
    expect(plano.apagar).toEqual(['1', '3']);
    expect(plano.preservados.map((p) => p.id)).toEqual(['2', '4']);
  });

  it('importacao inteira intocada some inteira', () => {
    const plano = planejarExclusao(Array.from({ length: 171 }, (_, i) => limpa({ id: String(i) })));
    expect(plano.apagar).toHaveLength(171);
    expect(plano.preservados).toHaveLength(0);
  });

  it('lista vazia nao explode', () => {
    expect(planejarExclusao([])).toEqual({ apagar: [], preservados: [] });
  });
});

describe('resumirPreservados', () => {
  it('agrupa por motivo, do mais comum para o menos', () => {
    const plano = planejarExclusao([
      limpa({ id: '1', categorySource: 'USER' }),
      limpa({ id: '2', categorySource: 'USER' }),
      limpa({ id: '3', notes: 'x' }),
    ]);
    expect(resumirPreservados(plano)).toEqual([
      { motivo: 'você definiu a categoria', quantas: 2 },
      { motivo: 'tem anotação sua', quantas: 1 },
    ]);
  });
});
