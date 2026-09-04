/**
 * Qual recurso sincronizar quando so cabe UM por requisicao.
 *
 * Extraido da rota para poder ser testado: a versao anterior ordenava por
 * `nextRunAt` logo depois de zerar o nextRunAt de todos, e o empate fazia o
 * e-mail vencer sempre — o calendario nunca sincronizava. Ver
 * escolha-recurso.test.ts
 */

export interface EstadoOrdenavel {
  resource: string;
  lastSyncAt: Date | null;
}

/** Nunca sincronizado primeiro; depois, o mais atrasado. */
export function escolherProximoRecurso<T extends EstadoOrdenavel>(estados: T[]): T | undefined {
  const quando = (d: Date | null) => (d ? d.getTime() : -1);
  return [...estados].sort((a, b) => quando(a.lastSyncAt) - quando(b.lastSyncAt))[0];
}

/**
 * Espalha a fila entre as contas: uma conta por vez, em rodadas.
 *
 * A fila vem ordenada pelo mais vencido, e isso sozinho deixa uma conta
 * tomar o orçamento inteiro — os dois recursos dela na frente, e as outras
 * cinco caixas esperando o próximo horário. Foi o que aconteceu em produção:
 * o ciclo das 07h sincronizou UMA conta e as outras cinco ficaram paradas no
 * sync das 19h da véspera.
 *
 * A ordem entre as contas é preservada (a mais vencida continua na frente);
 * o que muda é que ninguém repete antes de todo mundo ter a sua vez.
 */
export function intercalarPorConexao<T extends { connectionId: string }>(estados: T[]): T[] {
  const filas = new Map<string, T[]>();
  for (const estado of estados) {
    const fila = filas.get(estado.connectionId);
    if (fila) fila.push(estado);
    else filas.set(estado.connectionId, [estado]);
  }

  const saida: T[] = [];
  // `Map` preserva a ordem de INSERÇÃO, que aqui é a ordem de chegada na
  // fila já ordenada. Por isso a rodada respeita quem está mais vencido.
  while (saida.length < estados.length) {
    for (const fila of filas.values()) {
      const proximo = fila.shift();
      if (proximo) saida.push(proximo);
    }
  }
  return saida;
}
