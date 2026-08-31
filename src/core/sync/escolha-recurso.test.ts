import { describe, expect, it } from 'vitest';
import { escolherProximoRecurso } from './escolha-recurso';

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
