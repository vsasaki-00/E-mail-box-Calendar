/**
 * SLA de resposta por caixa. Ver docs/05-torre-de-controle.md (fase 3)
 *
 * "47 nao lidos" nao e uma metrica de nada: metade e newsletter. A metrica
 * que importa e **quem esta esperando resposta sua, e ha quanto tempo** —
 * e o prazo aceitavel muda por negocio: um cliente da caixa comercial
 * esperando 8h e um problema; um e-mail pessoal esperando 8h nao e.
 *
 * Funcoes puras, testaveis sem banco.
 */

export interface AwaitingReply {
  unifiedItemId: string;
  connectionId: string;
  /** Quando a mensagem chegou. */
  receivedAt: Date;
  priority: string;
  title: string;
  fromLabel: string;
}

export interface MailboxSla {
  connectionId: string;
  label: string;
  /** Prazo em horas para esta caixa. */
  slaHours: number;
  waiting: number;
  /** Quantos ja passaram do prazo. */
  overdue: number;
  /** Horas do mais antigo esperando. `null` quando nao ha ninguem esperando. */
  oldestHours: number | null;
}

/**
 * Prazo padrao por contexto de negocio.
 *
 * Caixa de negocio nasce com prazo curto e a pessoal com prazo longo, pela
 * mesma logica assimetrica da calibragem da triagem: demorar com um cliente
 * custa caro e demorar com uma newsletter nao custa nada.
 */
export const DEFAULT_SLA_HOURS: Record<string, number> = {
  Pessoais: 72,
  Outros: 48,
};
export const BUSINESS_SLA_HOURS = 8;

export function slaHoursFor(businessName: string | null | undefined): number {
  if (!businessName) return BUSINESS_SLA_HOURS;
  return DEFAULT_SLA_HOURS[businessName] ?? BUSINESS_SLA_HOURS;
}

/** Prioridade urgente encurta o prazo pela metade, com piso de 1h. */
export function effectiveSlaHours(slaHours: number, priority: string): number {
  return priority === 'URGENT' ? Math.max(1, Math.round(slaHours / 2)) : slaHours;
}

export function hoursWaiting(receivedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - receivedAt.getTime()) / 3_600_000));
}

export interface MailboxSlaConfig {
  connectionId: string;
  label: string;
  businessName: string | null;
}

/**
 * Calcula o SLA de cada caixa.
 *
 * Caixa sem ninguem esperando aparece com zero — e nao some. Sumir faria a
 * lista parecer menor do que o conjunto de caixas que voce tem, e a Torre
 * existe justamente para responder "esta tudo sob controle?" sobre TODAS.
 */
export function computeSla(
  aguardando: AwaitingReply[],
  caixas: MailboxSlaConfig[],
  now = new Date(),
): MailboxSla[] {
  const porConexao = new Map<string, AwaitingReply[]>();
  for (const item of aguardando) {
    const lista = porConexao.get(item.connectionId) ?? [];
    lista.push(item);
    porConexao.set(item.connectionId, lista);
  }

  return caixas.map((caixa) => {
    const itens = porConexao.get(caixa.connectionId) ?? [];
    const slaHours = slaHoursFor(caixa.businessName);

    const horas = itens.map((item) => hoursWaiting(item.receivedAt, now));
    const overdue = itens.filter(
      (item, i) => (horas[i] ?? 0) >= effectiveSlaHours(slaHours, item.priority),
    ).length;

    return {
      connectionId: caixa.connectionId,
      label: caixa.label,
      slaHours,
      waiting: itens.length,
      overdue,
      oldestHours: horas.length > 0 ? Math.max(...horas) : null,
    };
  });
}

/**
 * Os itens que mais precisam de voce agora: vencidos primeiro, e entre eles
 * o que espera ha mais tempo.
 */
export function mostOverdue(
  aguardando: AwaitingReply[],
  caixas: MailboxSlaConfig[],
  limite = 5,
  now = new Date(),
): (AwaitingReply & { hours: number; overdue: boolean })[] {
  const slaPorConexao = new Map(
    caixas.map((c) => [c.connectionId, slaHoursFor(c.businessName)] as const),
  );

  return aguardando
    .map((item) => {
      const sla = effectiveSlaHours(slaPorConexao.get(item.connectionId) ?? BUSINESS_SLA_HOURS, item.priority);
      const hours = hoursWaiting(item.receivedAt, now);
      return { ...item, hours, overdue: hours >= sla };
    })
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return b.hours - a.hours;
    })
    .slice(0, limite);
}
