import { prisma } from '@/lib/db';
import {
  ciclosPorDia,
  diasSemCiclo,
  resumirPorProvedor,
  resumirPorRecurso,
  serieDeDias,
  totalizar,
  type CorridaBruta,
  type DiaDaSerie,
  type Resumo,
} from './saude';

/**
 * Leitura do painel de saúde. Ver docs/13-saude.md
 *
 * Só busca e monta; toda a aritmética vive em `saude.ts`, que não conhece
 * Prisma. A separação não é cerimônia: é o que permite testar "órfã não
 * entra na média" sem subir banco.
 */

/** Períodos oferecidos na tela. Sete dias é o padrão: cobre a semana toda. */
export const PERIODOS = [1, 7, 30] as const;
export type Periodo = (typeof PERIODOS)[number];

export function periodoValido(bruto: string | undefined): Periodo {
  const n = Number(bruto);
  return (PERIODOS as readonly number[]).includes(n) ? (n as Periodo) : 7;
}

export interface EstadoAtual {
  connectionId: string;
  conta: string;
  provider: string;
  resource: string;
  status: string;
  failureCount: number;
  nextRunAt: Date | null;
  lastSyncAt: Date | null;
  lastFullSyncAt: Date | null;
  /** Tem cursor? Sem ele, o próximo sync é full — mais caro e mais lento. */
  temCursor: boolean;
  /** Vencido: deveria ter rodado e não rodou. */
  vencido: boolean;
  /** Conexão desativada ou pedindo reautenticação: não entra na fila. */
  foraDaFila: boolean;
}

export interface DadosSaude {
  periodoDias: number;
  inicio: Date;
  agora: Date;
  porProvedor: Resumo[];
  porRecurso: Resumo[];
  total: ReturnType<typeof totalizar>;
  /** Todos os dias do período, os de zero inclusive. */
  ciclos: DiaDaSerie[];
  diasSemVolta: string[];
  estados: EstadoAtual[];
  alertas: {
    id: string;
    severity: string;
    kind: string;
    title: string;
    detail: string | null;
    createdAt: Date;
  }[];
  /** Sem conta conectada a tela não tem o que medir, e diz isso. */
  semConexoes: boolean;
}

const FORA_DA_FILA = ['DISABLED', 'REAUTH_REQUIRED'];

export async function carregarSaude(periodoDias: number, agora = new Date()): Promise<DadosSaude> {
  const inicio = new Date(agora.getTime() - periodoDias * 24 * 60 * 60 * 1000);
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!usuario) {
    return {
      periodoDias,
      inicio,
      agora,
      porProvedor: [],
      porRecurso: [],
      total: totalizar([]),
      ciclos: [],
      diasSemVolta: [],
      estados: [],
      alertas: [],
      semConexoes: true,
    };
  }

  const [runs, estadosBrutos, alertas, quantasConexoes] = await Promise.all([
    prisma.syncRun.findMany({
      where: { startedAt: { gte: inicio }, connection: { userId: usuario.id } },
      orderBy: { startedAt: 'desc' },
      // Teto de segurança: um full sync paginado gera muita corrida, e a
      // tela não pode virar a consulta mais cara do app.
      take: 5000,
      select: {
        connectionId: true,
        resource: true,
        startedAt: true,
        finishedAt: true,
        outcome: true,
        itemsCreated: true,
        itemsUpdated: true,
        itemsDeleted: true,
        errorMessage: true,
        connection: { select: { provider: true, accountEmail: true } },
      },
    }),
    prisma.syncState.findMany({
      where: { connection: { userId: usuario.id } },
      select: {
        connectionId: true,
        resource: true,
        status: true,
        failureCount: true,
        nextRunAt: true,
        lastSyncAt: true,
        lastFullSyncAt: true,
        cursor: true,
        connection: { select: { provider: true, accountEmail: true, status: true } },
      },
    }),
    prisma.alert.findMany({
      where: { userId: usuario.id, acknowledgedAt: null },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      select: { id: true, severity: true, kind: true, title: true, detail: true, createdAt: true },
    }),
    prisma.connection.count({ where: { userId: usuario.id } }),
  ]);

  const corridas: CorridaBruta[] = runs.map((r) => ({
    connectionId: r.connectionId,
    provider: r.connection.provider,
    conta: r.connection.accountEmail,
    resource: r.resource,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    outcome: r.outcome,
    itens: r.itemsCreated + r.itemsUpdated + r.itemsDeleted,
    errorMessage: r.errorMessage,
  }));

  const porProvedor = resumirPorProvedor(corridas, agora);
  const contagem = ciclosPorDia(corridas);

  const estados: EstadoAtual[] = estadosBrutos
    .map((e) => ({
      connectionId: e.connectionId,
      conta: e.connection.accountEmail,
      provider: e.connection.provider,
      resource: e.resource,
      status: e.status,
      failureCount: e.failureCount,
      nextRunAt: e.nextRunAt,
      lastSyncAt: e.lastSyncAt,
      lastFullSyncAt: e.lastFullSyncAt,
      temCursor: Boolean(e.cursor),
      // Mesma definição que o motor usa para escolher (`filtroVencidos`):
      // sem `nextRunAt`, ou com ele no passado.
      vencido:
        !FORA_DA_FILA.includes(e.connection.status) &&
        (e.nextRunAt === null || e.nextRunAt.getTime() <= agora.getTime()),
      foraDaFila: FORA_DA_FILA.includes(e.connection.status),
    }))
    .sort(
      (a, b) =>
        Number(b.failureCount > 0) - Number(a.failureCount > 0) ||
        a.conta.localeCompare(b.conta) ||
        a.resource.localeCompare(b.resource),
    );

  return {
    periodoDias,
    inicio,
    agora,
    porProvedor,
    porRecurso: resumirPorRecurso(corridas, agora),
    total: totalizar(porProvedor),
    ciclos: serieDeDias(contagem, inicio, agora),
    diasSemVolta: diasSemCiclo(contagem, inicio, agora),
    estados,
    alertas,
    semConexoes: quantasConexoes === 0,
  };
}
