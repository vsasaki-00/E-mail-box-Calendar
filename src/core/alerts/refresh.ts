import { syncAlerts, type AlertSyncResult } from './persist';
import { deriveAlerts, type AlertConflictState } from './rules';
import type { Conflict } from '@/core/metrics/conflicts';
import type { ConnectionHealth } from '@/core/metrics/control-tower';
import type { MailboxSla } from '@/core/metrics/sla';

/**
 * Recalcula os alertas a partir do MESMO estado que a Torre esta mostrando.
 * Ver docs/05-torre-de-controle.md
 *
 * Derivar dos dados ja carregados, e nao de uma consulta propria, e
 * deliberado: uma lista de alertas que discorda dos numeros ao lado dela e
 * pior do que nao ter alerta nenhum. Se o painel diz "nenhuma conta
 * atrasada" e o alerta diz "conta atrasada", voce para de acreditar nos
 * dois.
 */

export interface AlertRefreshInput {
  connections: ConnectionHealth[];
  conflicts: Conflict[];
  sla: MailboxSla[];
  bills: {
    unifiedItemId: string;
    payee: string | null;
    amountCents: number | null;
    daysUntilDue: number | null;
  }[];
}

export async function refreshAlerts(
  userId: string,
  input: AlertRefreshInput,
): Promise<AlertSyncResult> {
  const conflitos: AlertConflictState[] = input.conflicts.map((conflito) => ({
    ids: [conflito.a.id, conflito.b.id],
    titleA: conflito.a.title,
    titleB: conflito.b.title,
    crossAccount: conflito.crossAccount,
    startsAt: conflito.a.startsAt,
  }));

  const derivados = deriveAlerts({
    connections: input.connections.map((conexao) => ({
      id: conexao.id,
      label: conexao.displayName ?? conexao.accountEmail,
      status: conexao.status,
      isStale: conexao.isStale,
      minutesSinceSync: conexao.minutesSinceSync,
      lastErrorMessage: conexao.lastErrorMessage,
    })),
    conflicts: conflitos,
    sla: input.sla
      .filter((caixa) => caixa.overdue > 0)
      .map((caixa) => ({
        connectionId: caixa.connectionId,
        label: caixa.label,
        overdue: caixa.overdue,
        oldestHours: caixa.oldestHours ?? 0,
        slaHours: caixa.slaHours,
      })),
    // Cobranca sem vencimento identificado nao vira alerta de prazo: nao ha
    // prazo para alertar. Ela continua visivel no painel financeiro, que e
    // onde ela precisa aparecer.
    bills: input.bills
      .filter((c): c is typeof c & { daysUntilDue: number } => c.daysUntilDue !== null)
      .map((c) => ({
        unifiedItemId: c.unifiedItemId,
        payee: c.payee,
        amountCents: c.amountCents,
        daysUntilDue: c.daysUntilDue,
      })),
  });

  return syncAlerts(userId, derivados);
}
