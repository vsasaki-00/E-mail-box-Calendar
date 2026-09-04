import { describe, expect, it } from 'vitest';
import { coberturaDaUltimaVolta } from './cobertura';

const base = new Date('2026-09-04T10:07:00Z').getTime();
const min = (n: number) => new Date(base - n * 60_000);

describe('coberturaDaUltimaVolta', () => {
  it('o caso de producao: a volta aconteceu e pegou UMA de seis', () => {
    const c = coberturaDaUltimaVolta([
      { lastSyncAt: min(1) }, // pegou
      { lastSyncAt: min(15 * 60) }, // paradas desde a vespera
      { lastSyncAt: min(15 * 60) },
      { lastSyncAt: min(21 * 60) },
      { lastSyncAt: min(21 * 60) },
      { lastSyncAt: min(15 * 60) },
    ]);
    expect(c.alcancadas).toBe(1);
    expect(c.total).toBe(6);
    expect(c.ultima).toEqual(min(1));
  });

  it('contas terminadas ao longo da mesma volta contam juntas', () => {
    // O laco roda ate 15 min e a triagem vem depois: uma volta se espalha.
    const c = coberturaDaUltimaVolta([
      { lastSyncAt: min(0) },
      { lastSyncAt: min(9) },
      { lastSyncAt: min(23) },
    ]);
    expect(c.alcancadas).toBe(3);
  });

  it('conta que nunca sincronizou nao foi alcancada, mas conta no total', () => {
    const c = coberturaDaUltimaVolta([{ lastSyncAt: min(2) }, { lastSyncAt: null }]);
    expect(c).toEqual({ ultima: min(2), alcancadas: 1, total: 2 });
  });

  it('sem nenhum sync, nao inventa uma volta', () => {
    expect(coberturaDaUltimaVolta([{ lastSyncAt: null }])).toEqual({
      ultima: null,
      alcancadas: 0,
      total: 1,
    });
    expect(coberturaDaUltimaVolta([])).toEqual({ ultima: null, alcancadas: 0, total: 0 });
  });

  it('a borda da janela pertence a volta', () => {
    expect(coberturaDaUltimaVolta([{ lastSyncAt: min(0) }, { lastSyncAt: min(60) }]).alcancadas)
      .toBe(2);
    expect(coberturaDaUltimaVolta([{ lastSyncAt: min(0) }, { lastSyncAt: min(61) }]).alcancadas)
      .toBe(1);
  });
});
