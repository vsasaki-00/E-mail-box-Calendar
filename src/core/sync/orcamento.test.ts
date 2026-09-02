import { describe, expect, it } from 'vitest';
import { podeIniciarRecurso } from './orcamento';

describe('podeIniciarRecurso', () => {
  it('sem orçamento, roda tudo — é o caso do worker local', () => {
    expect(podeIniciarRecurso(0, undefined, 0)).toBe(true);
    expect(podeIniciarRecurso(99, undefined, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('para de pegar recurso novo quando o prazo passa', () => {
    expect(podeIniciarRecurso(3, 1_000, 999)).toBe(true);
    expect(podeIniciarRecurso(3, 1_000, 1_000)).toBe(false);
    expect(podeIniciarRecurso(3, 1_000, 5_000)).toBe(false);
  });

  it('o primeiro roda mesmo com o prazo já vencido', () => {
    // Sem isto, um disparo que chega atrasado nao sincronizaria nada, para
    // sempre, sem erro nenhum.
    expect(podeIniciarRecurso(0, 1_000, 9_999)).toBe(true);
  });
});
