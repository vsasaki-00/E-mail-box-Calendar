import { describe, expect, it } from 'vitest';
import { resolverPeriodo } from './periodo';

const TZ = 'America/Sao_Paulo';
// 31/08/2026 23:30 em Sao Paulo = 01/09 02:30 UTC. O caso que quebra
// qualquer filtro feito em UTC.
const AGORA = new Date('2026-09-01T02:30:00Z');

describe('resolverPeriodo', () => {
  it('"este mes" e agosto, nao setembro, as 23h30 de 31/08 em Sao Paulo', () => {
    const p = resolverPeriodo({ atalho: 'mes' }, TZ, AGORA);
    expect(p.inicio?.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(p.fim?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(p.deIso).toBe('2026-08-01');
    expect(p.ateIso).toBe('2026-08-31');
  });

  it('"mes passado" fecha no ultimo dia do mes anterior', () => {
    const p = resolverPeriodo({ atalho: 'mes-passado' }, TZ, AGORA);
    expect(p.deIso).toBe('2026-07-01');
    expect(p.ateIso).toBe('2026-07-31');
    expect(p.fim?.toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('30 dias inclui hoje', () => {
    const p = resolverPeriodo({ atalho: '30d' }, TZ, AGORA);
    expect(p.deIso).toBe('2026-08-02');
    expect(p.ateIso).toBe('2026-08-31');
    // fim exclusivo = inicio de 01/09 local
    expect(p.fim?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('ano vai de 1/1 a 31/12', () => {
    const p = resolverPeriodo({ atalho: 'ano' }, TZ, AGORA);
    expect(p.inicio?.toISOString()).toBe('2026-01-01T03:00:00.000Z');
    expect(p.fim?.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    expect(p.rotulo).toBe('2026');
  });

  it('tudo nao limita', () => {
    const p = resolverPeriodo({ atalho: 'tudo' }, TZ, AGORA);
    expect(p.inicio).toBeUndefined();
    expect(p.fim).toBeUndefined();
  });

  it('datas explicitas mandam, e o "ate" e inclusivo', () => {
    const p = resolverPeriodo({ atalho: 'ano', de: '2026-03-10', ate: '2026-03-15' }, TZ, AGORA);
    expect(p.atalho).toBeUndefined();
    expect(p.inicio?.toISOString()).toBe('2026-03-10T03:00:00.000Z');
    // 15/03 inteiro entra: fim = inicio de 16/03
    expect(p.fim?.toISOString()).toBe('2026-03-16T03:00:00.000Z');
    expect(p.rotulo).toBe('10/03/2026 a 15/03/2026');
  });

  it('so "de" ou so "ate" tambem funcionam', () => {
    expect(resolverPeriodo({ de: '2026-03-10' }, TZ, AGORA).rotulo).toBe('a partir de 10/03/2026');
    const so = resolverPeriodo({ ate: '2026-03-10' }, TZ, AGORA);
    expect(so.inicio).toBeUndefined();
    expect(so.rotulo).toBe('até 10/03/2026');
  });

  it('data invalida e ignorada e cai no padrao (este mes)', () => {
    expect(resolverPeriodo({ de: '2026-02-31' }, TZ, AGORA).atalho).toBe('mes');
    expect(resolverPeriodo({ de: 'ontem' }, TZ, AGORA).atalho).toBe('mes');
    expect(resolverPeriodo({ atalho: 'xyz' }, TZ, AGORA).atalho).toBe('mes');
  });
});
