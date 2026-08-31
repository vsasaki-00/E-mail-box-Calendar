/**
 * Regras que derivam alertas do estado. Ver docs/05-torre-de-controle.md
 *
 * Funcoes puras: recebem o estado, devolvem os alertas que DEVEM existir
 * agora. Quem grava decide o resto.
 *
 * A ideia central e essa: o conjunto devolvido aqui e a verdade do momento.
 * Alerta nao e evento que se acumula — e condicao que vale ou nao vale. Um
 * painel que enche de alerta velho para de ser lido, e a partir dai ele
 * nao protege mais de nada.
 */

export type AlertSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export type AlertKind =
  | 'REAUTH_NEEDED'
  | 'CONNECTION_ERROR'
  | 'SYNC_STALE'
  | 'CALENDAR_CONFLICT'
  | 'SLA_BREACH'
  | 'BILL_DUE';

export interface DerivedAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  /**
   * Identidade da CONDICAO, nao da ocorrencia.
   *
   * E o que faz a mesma conta atrasada nao virar um alerta novo a cada
   * verificacao. Precisa ser estavel enquanto a condicao durar, e mudar
   * quando ela for outra condicao.
   */
  dedupeKey: string;
  context: Record<string, unknown>;
}

export interface AlertConnectionState {
  id: string;
  label: string;
  status: string;
  isStale: boolean;
  minutesSinceSync: number | null;
  lastErrorMessage: string | null;
}

export interface AlertConflictState {
  /** Ids das duas copias em conflito, ja ordenados. */
  ids: [string, string];
  titleA: string;
  titleB: string;
  /** Contas diferentes = conflito de verdade, nao a mesma reuniao duplicada. */
  crossAccount: boolean;
  startsAt: Date;
}

export interface AlertSlaState {
  connectionId: string;
  label: string;
  /** Itens que precisam de resposta e ja passaram do prazo daquela caixa. */
  overdue: number;
  /** Horas do mais antigo esperando. */
  oldestHours: number;
  slaHours: number;
}

export interface AlertBillState {
  unifiedItemId: string;
  payee: string | null;
  amountCents: number | null;
  /** Negativo = ja venceu. */
  daysUntilDue: number;
}

/** A partir de quantos dias antes do vencimento a cobranca vira alerta. */
export const BILL_ALERT_DAYS = 3;

function formatarValor(cents: number | null): string {
  if (cents === null) return 'valor não identificado';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Conexao com problema.
 *
 * `REAUTH_REQUIRED` e critico e `SYNC_STALE` e aviso de proposito: uma conta
 * que precisa de reautenticacao **parou** e so voce pode destravar; uma
 * atrasada normalmente se resolve sozinha no proximo ciclo.
 */
export function connectionAlerts(conexoes: AlertConnectionState[]): DerivedAlert[] {
  const alertas: DerivedAlert[] = [];

  for (const conexao of conexoes) {
    if (conexao.status === 'REAUTH_REQUIRED') {
      alertas.push({
        kind: 'REAUTH_NEEDED',
        severity: 'CRITICAL',
        title: `${conexao.label} precisa ser reconectada`,
        detail:
          'Esta caixa parou de sincronizar e só você pode destravar. Enquanto isso, ' +
          'tudo que ela mostra está congelado no último sync.',
        dedupeKey: `reauth:${conexao.id}`,
        context: { connectionId: conexao.id },
      });
      // Uma conta parada por reautenticacao TAMBEM esta atrasada. Emitir os
      // dois seria dizer a mesma coisa duas vezes.
      continue;
    }

    if (conexao.status === 'ERROR' || conexao.status === 'DISABLED') {
      alertas.push({
        kind: 'CONNECTION_ERROR',
        severity: 'CRITICAL',
        title: `${conexao.label} está com erro`,
        detail: conexao.lastErrorMessage,
        dedupeKey: `conn-error:${conexao.id}`,
        context: { connectionId: conexao.id, status: conexao.status },
      });
      continue;
    }

    if (conexao.isStale) {
      const horas =
        conexao.minutesSinceSync === null ? null : Math.floor(conexao.minutesSinceSync / 60);
      alertas.push({
        kind: 'SYNC_STALE',
        severity: 'WARN',
        title: `${conexao.label} está atrasada`,
        detail:
          conexao.minutesSinceSync === null
            ? 'Esta conta nunca sincronizou.'
            : `Último sync há ${horas !== null && horas >= 1 ? `${horas}h` : `${Math.round(conexao.minutesSinceSync)}min`}. ` +
              'Silêncio não é saúde: o que você vê dela pode estar velho.',
        dedupeKey: `sync-stale:${conexao.id}`,
        context: { connectionId: conexao.id },
      });
    }
  }

  return alertas;
}

/**
 * Conflito de agenda.
 *
 * So entre contas DIFERENTES: sobreposicao dentro da mesma agenda voce
 * enxerga abrindo ela. O valor deste produto e ver o choque que nenhuma
 * agenda sozinha mostra.
 */
export function conflictAlerts(conflitos: AlertConflictState[]): DerivedAlert[] {
  return conflitos
    .filter((conflito) => conflito.crossAccount)
    .map((conflito) => ({
      kind: 'CALENDAR_CONFLICT' as const,
      severity: 'CRITICAL' as const,
      title: 'Conflito de agenda entre contas diferentes',
      detail: `“${conflito.titleA}” e “${conflito.titleB}” se sobrepõem.`,
      // Os ids ordenados: o mesmo par nao pode virar dois alertas conforme
      // a ordem em que a deteccao devolveu.
      dedupeKey: `conflict:${[...conflito.ids].sort().join(':')}`,
      context: { ids: conflito.ids, startsAt: conflito.startsAt.toISOString() },
    }));
}

/** Caixa com resposta vencendo o prazo que voce definiu para ela. */
export function slaAlerts(estados: AlertSlaState[]): DerivedAlert[] {
  return estados
    .filter((estado) => estado.overdue > 0)
    .map((estado) => ({
      kind: 'SLA_BREACH' as const,
      severity: estado.oldestHours >= estado.slaHours * 2 ? ('CRITICAL' as const) : ('WARN' as const),
      title: `${estado.label}: ${estado.overdue} ${estado.overdue === 1 ? 'e-mail passou' : 'e-mails passaram'} do prazo`,
      detail:
        `O mais antigo espera há ${estado.oldestHours}h, e o prazo desta caixa é ` +
        `${estado.slaHours}h.`,
      // A chave nao inclui a contagem: a condicao e "esta caixa esta
      // atrasada", e ela continua a mesma quando o numero muda de 3 para 4.
      dedupeKey: `sla:${estado.connectionId}`,
      context: { connectionId: estado.connectionId, overdue: estado.overdue },
    }));
}

/** Cobranca vencendo ou vencida. */
export function billAlerts(cobrancas: AlertBillState[]): DerivedAlert[] {
  return cobrancas
    .filter((cobranca) => cobranca.daysUntilDue <= BILL_ALERT_DAYS)
    .map((cobranca) => {
      const vencida = cobranca.daysUntilDue < 0;
      const quem = cobranca.payee ?? 'Beneficiário não identificado';
      return {
        kind: 'BILL_DUE' as const,
        severity: vencida ? ('CRITICAL' as const) : ('WARN' as const),
        title: vencida
          ? `${quem}: cobrança vencida há ${Math.abs(cobranca.daysUntilDue)}d`
          : `${quem}: cobrança vence ${cobranca.daysUntilDue === 0 ? 'hoje' : `em ${cobranca.daysUntilDue}d`}`,
        detail:
          `${formatarValor(cobranca.amountCents)}. Detecção automática — não é ` +
          'garantia de que todas as cobranças foram encontradas.',
        dedupeKey: `bill:${cobranca.unifiedItemId}`,
        context: { unifiedItemId: cobranca.unifiedItemId },
      };
    });
}

export interface AlertInputs {
  connections: AlertConnectionState[];
  conflicts: AlertConflictState[];
  sla: AlertSlaState[];
  bills: AlertBillState[];
}

const ORDEM_SEVERIDADE: Record<AlertSeverity, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };

/** Todos os alertas que devem existir agora, do mais grave para o menos. */
export function deriveAlerts(inputs: AlertInputs): DerivedAlert[] {
  return [
    ...connectionAlerts(inputs.connections),
    ...conflictAlerts(inputs.conflicts),
    ...slaAlerts(inputs.sla),
    ...billAlerts(inputs.bills),
  ].sort((a, b) => ORDEM_SEVERIDADE[a.severity] - ORDEM_SEVERIDADE[b.severity]);
}
