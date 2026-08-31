import { prisma } from '@/lib/db';
import type { DerivedAlert } from './rules';

/**
 * Grava os alertas derivados. Ver docs/05-torre-de-controle.md
 *
 * Duas regras que definem se o painel de alertas vai ser lido ou ignorado:
 *
 * 1. **Deduplicacao**: a mesma condicao nao vira alerta novo a cada
 *    verificacao. O `dedupeKey` identifica a CONDICAO, e reaparecer so
 *    atualiza a linha existente.
 *
 * 2. **Resolucao automatica**: quando a condicao deixa de valer, o alerta
 *    SOME sozinho. Exigir que voce feche na mao o alerta de uma conta que
 *    ja voltou a sincronizar e o caminho mais curto para voce parar de ler
 *    os alertas — e ai eles nao protegem de mais nada.
 */

export interface AlertSyncResult {
  created: number;
  updated: number;
  /** Condicoes que deixaram de valer e sumiram sozinhas. */
  resolved: number;
}

/**
 * Reconcilia os alertas do usuario com o conjunto que deve existir agora.
 *
 * O reconhecimento (`acknowledgedAt`) sobrevive enquanto a condicao durar:
 * voce disse "eu sei", e nao faz sentido reabrir a cada ciclo. Mas se a
 * condicao se resolve e volta depois, a linha antiga ja foi apagada, entao
 * nasce uma linha nova e o alerta volta a aparecer — que e o certo: e um
 * problema novo, ainda que pareca o mesmo.
 */
export async function syncAlerts(
  userId: string,
  desejados: DerivedAlert[],
): Promise<AlertSyncResult> {
  const existentes = await prisma.alert.findMany({
    where: { userId },
    select: { id: true, dedupeKey: true },
  });

  const chavesDesejadas = new Set(desejados.map((a) => a.dedupeKey));
  const paraApagar = existentes.filter((a) => !chavesDesejadas.has(a.dedupeKey));

  let resolved = 0;
  if (paraApagar.length > 0) {
    const { count } = await prisma.alert.deleteMany({
      where: { id: { in: paraApagar.map((a) => a.id) } },
    });
    resolved = count;
  }

  const chavesExistentes = new Set(existentes.map((a) => a.dedupeKey));
  let created = 0;
  let updated = 0;

  for (const alerta of desejados) {
    const dados = {
      severity: alerta.severity,
      kind: alerta.kind,
      title: alerta.title,
      detail: alerta.detail,
      context: alerta.context as object,
    };

    await prisma.alert.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey: alerta.dedupeKey } },
      create: { userId, dedupeKey: alerta.dedupeKey, ...dados },
      // `acknowledgedAt` fica de fora do update: reabrir o que voce ja
      // reconheceu, a cada ciclo, seria o mesmo que nao ter reconhecimento.
      update: dados,
    });

    if (chavesExistentes.has(alerta.dedupeKey)) updated += 1;
    else created += 1;
  }

  return { created, updated, resolved };
}

/** "Eu sei disso." Silencia enquanto a condicao durar, sem apagar. */
export async function acknowledgeAlert(alertId: string, userId: string): Promise<void> {
  await prisma.alert.updateMany({
    where: { id: alertId, userId },
    data: { acknowledgedAt: new Date() },
  });
}

export async function unacknowledgeAlert(alertId: string, userId: string): Promise<void> {
  await prisma.alert.updateMany({
    where: { id: alertId, userId },
    data: { acknowledgedAt: null },
  });
}
