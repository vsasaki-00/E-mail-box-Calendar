import { describe, expect, it } from 'vitest';
import { escolherProximoRecurso, intercalarPorConexao } from './escolha-recurso';

/**
 * Qual recurso sincronizar quando so cabe um por requisicao.
 *
 * O bug que motivou isto: a rota escolhia por `nextRunAt` depois de chamar
 * `agendarSyncImediato`, que zera o nextRunAt de TODOS para o mesmo
 * instante. Com empate, a ordem da consulta decidia — e-mail sempre ganhava
 * e o CALENDARIO NUNCA RODAVA. A agenda ficou vazia com o e-mail chegando
 * normalmente, e nada na tela explicava por que.
 */

const T = (ms: number) => new Date(ms);

describe('escolherProximoRecurso', () => {
  it('prefere quem nunca sincronizou', () => {
    const escolhido = escolherProximoRecurso([
      { resource: 'MAIL', lastSyncAt: T(1_000) },
      { resource: 'CALENDAR', lastSyncAt: null },
    ]);
    expect(escolhido?.resource).toBe('CALENDAR');
  });

  it('depois disso, escolhe o mais atrasado', () => {
    const escolhido = escolherProximoRecurso([
      { resource: 'MAIL', lastSyncAt: T(5_000) },
      { resource: 'CALENDAR', lastSyncAt: T(2_000) },
    ]);
    expect(escolhido?.resource).toBe('CALENDAR');
  });

  it('alterna entre os recursos em vez de repetir um so', () => {
    // O cenario real: cada execucao atualiza o lastSyncAt do escolhido. Se a
    // regra estiver errada, um recurso monopoliza todas as voltas.
    const estados = [
      { resource: 'MAIL', lastSyncAt: null as Date | null },
      { resource: 'CALENDAR', lastSyncAt: null as Date | null },
    ];
    const escolhidos: string[] = [];

    for (let volta = 1; volta <= 6; volta += 1) {
      const escolhido = escolherProximoRecurso(estados)!;
      escolhidos.push(escolhido.resource);
      escolhido.lastSyncAt = T(volta * 1_000);
    }

    expect(escolhidos.filter((r) => r === 'MAIL')).toHaveLength(3);
    expect(escolhidos.filter((r) => r === 'CALENDAR')).toHaveLength(3);
  });

  it('devolve undefined quando nao ha estado nenhum', () => {
    expect(escolherProximoRecurso([])).toBeUndefined();
  });
});

describe('intercalarPorConexao', () => {
  const fila = (...pares: [string, string][]) =>
    pares.map(([connectionId, resource]) => ({ connectionId, resource }));

  it('uma conta nao roda duas vezes antes de todo mundo rodar uma', () => {
    // O caso de producao: 6 contas × 2 recursos, e o orcamento so da para
    // alguns. Sem intercalar, as 5 primeiras vagas iam para 3 contas.
    const ordenado = intercalarPorConexao(
      fila(['a', 'MAIL'], ['a', 'CALENDAR'], ['b', 'MAIL'], ['b', 'CALENDAR'], ['c', 'MAIL']),
    );
    expect(ordenado.map((e) => e.connectionId)).toEqual(['a', 'b', 'c', 'a', 'b']);
  });

  it('preserva a ordem entre contas: a mais vencida continua na frente', () => {
    const ordenado = intercalarPorConexao(fila(['z', 'MAIL'], ['a', 'MAIL']));
    expect(ordenado.map((e) => e.connectionId)).toEqual(['z', 'a']);
  });

  it('nao perde nem duplica nada', () => {
    const entrada = fila(['a', 'MAIL'], ['a', 'CALENDAR'], ['a', 'CONTACTS'], ['b', 'MAIL']);
    const saida = intercalarPorConexao(entrada);
    expect(saida).toHaveLength(entrada.length);
    expect(new Set(saida)).toEqual(new Set(entrada));
  });

  it('lista vazia nao trava', () => {
    expect(intercalarPorConexao([])).toEqual([]);
  });
});
