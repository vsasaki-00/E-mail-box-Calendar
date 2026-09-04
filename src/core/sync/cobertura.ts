/**
 * Quantas caixas a última volta do agendamento realmente pegou.
 *
 * "Último ciclo em 04/09, 07:07" é verdade e engana. Em produção essa volta
 * sincronizou UMA das seis contas — as outras cinco estavam paradas no sync
 * da véspera —, e mesmo assim a faixa dizia que o agendamento estava de pé.
 * O que responde "o automático está funcionando?" não é *quando* a última
 * volta aconteceu, é *quanto* dela aconteceu.
 */

/**
 * Tolerância para considerar dois syncs como sendo da MESMA volta.
 *
 * A volta não é instantânea: o laço do agendamento roda até 15 minutos e a
 * triagem vem depois, então as contas de uma mesma volta terminam espalhadas
 * ao longo de uns 25 minutos. Uma hora dá folga sobre isso sem chegar perto
 * do intervalo entre voltas (6 h, o menor do dia).
 */
export const JANELA_DA_VOLTA_MS = 60 * 60_000;

export interface Cobertura {
  /** O sync mais recente de qualquer caixa. `null` = nunca rodou. */
  ultima: Date | null;
  alcancadas: number;
  total: number;
}

export function coberturaDaUltimaVolta(
  contas: { lastSyncAt: Date | null }[],
  janelaMs = JANELA_DA_VOLTA_MS,
): Cobertura {
  const datas = contas
    .map((c) => c.lastSyncAt)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());

  if (datas.length === 0) return { ultima: null, alcancadas: 0, total: contas.length };

  const ultima = Math.max(...datas);
  return {
    ultima: new Date(ultima),
    alcancadas: datas.filter((d) => ultima - d <= janelaMs).length,
    total: contas.length,
  };
}
