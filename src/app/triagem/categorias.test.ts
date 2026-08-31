import { describe, expect, it } from 'vitest';
import { TriageCategory, TriagePriority } from '@prisma/client';
import { CATEGORIA_LABEL, PRIORIDADE_LABEL } from './rotulos';

/**
 * Os rotulos da interface contra o enum do banco.
 *
 * A correcao em lote nasceu com uma lista inventada ("PROMOTION", "FYI") e
 * TODA aplicacao voltava "Categoria invalida" — os nomes reais sao
 * COBRANCA/NEEDS_REPLY/INFORMATIVE/PROMOTIONAL/SPAM/DISPOSABLE. Um valor de
 * enum digitado a mao so falha em tempo de execucao, e so quando alguem
 * clica; aqui falha no teste.
 */

describe('rotulos da triagem x enum do banco', () => {
  it('cobre exatamente as categorias que existem', () => {
    expect(Object.keys(CATEGORIA_LABEL).sort()).toEqual(Object.values(TriageCategory).sort());
  });

  it('cobre exatamente as prioridades que existem', () => {
    expect(Object.keys(PRIORIDADE_LABEL).sort()).toEqual(Object.values(TriagePriority).sort());
  });

  it('nenhum rotulo vazio — o select mostraria uma opcao em branco', () => {
    for (const rotulo of [...Object.values(CATEGORIA_LABEL), ...Object.values(PRIORIDADE_LABEL)]) {
      expect(rotulo.trim().length).toBeGreaterThan(0);
    }
  });
});
