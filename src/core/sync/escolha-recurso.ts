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
