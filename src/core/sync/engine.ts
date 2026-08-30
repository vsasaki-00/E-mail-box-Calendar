import type { Connection, SyncResource, SyncState } from '@prisma/client';
import { prisma } from '@/lib/db';
import { decryptSecret, keyringFromEnv, type Keyring } from '@/lib/crypto';
import { getConnector } from '@/lib/connectors/registry';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorCredentials,
} from '@/lib/connectors/types';
import { decideAfterError, decideAfterSuccess } from './backoff';

/**
 * Motor de sincronizacao. Ver ADR-3 em docs/01-arquitetura.md
 *
 * Responsabilidades: escolher o que esta vencido, montar o contexto do conector
 * (decifrando credenciais), executar, e traduzir o resultado em cursor + estado.
 * Nao conhece nenhum provedor: tudo passa pela interface Connector.
 */

export interface SyncResult {
  connectionId: string;
  resource: SyncResource;
  outcome: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  itemsCreated: number;
  itemsUpdated: number;
  errorMessage?: string;
}

/** Estados vencidos, prontos para rodar. Conexoes desativadas ficam de fora. */
export async function findDueSyncStates(now = new Date(), limit = 20) {
  return prisma.syncState.findMany({
    where: {
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      connection: { status: { notIn: ['DISABLED'] } },
    },
    orderBy: { nextRunAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    include: { connection: true },
  });
}

function buildContext(
  connection: Connection,
  keyring: Keyring,
): ConnectorContext {
  let credentials: ConnectorCredentials = {};

  if (connection.secretCiphertext && connection.secretIv && connection.secretTag) {
    const plaintext = decryptSecret(
      {
        ciphertext: connection.secretCiphertext,
        iv: connection.secretIv,
        tag: connection.secretTag,
        keyId: connection.secretKeyId ?? keyring.currentKeyId,
      },
      keyring,
    );
    credentials = JSON.parse(plaintext) as ConnectorCredentials;
  }

  return {
    connectionId: connection.id,
    accountEmail: connection.accountEmail,
    credentials,
    config: (connection.config as Record<string, unknown>) ?? {},
  };
}

/**
 * Executa um recurso de uma conexao e persiste o resultado.
 *
 * O SyncRun e aberto antes da execucao e fechado sempre — inclusive em falha —
 * porque e ele que responde "por que a agenda esta desatualizada?" no painel.
 */
export async function runSync(
  syncState: SyncState & { connection: Connection },
  now = new Date(),
): Promise<SyncResult> {
  const { connection, resource } = syncState;
  const connector = getConnector(connection.provider);
  const pollInterval = connector.capabilities.pollIntervalSeconds;

  const run = await prisma.syncRun.create({
    data: { connectionId: connection.id, resource, startedAt: now },
  });

  await prisma.syncState.update({
    where: { id: syncState.id },
    data: { status: 'RUNNING' },
  });

  try {
    const keyring = keyringFromEnv();
    const context = buildContext(connection, keyring);

    // Cursor ausente = full sync da janela; presente = incremental.
    const page =
      resource === 'MAIL'
        ? await connector.fetchMessages(context, { cursor: syncState.cursor ?? undefined })
        : await connector.fetchEvents(context, { cursor: syncState.cursor ?? undefined });

    const decision = decideAfterSuccess(pollInterval, now);

    await prisma.$transaction([
      prisma.syncState.update({
        where: { id: syncState.id },
        data: {
          // So avancamos o cursor ao terminar a paginacao: gravar no meio faria
          // um sync interrompido perder as paginas restantes para sempre.
          cursor: page.nextPageToken ? syncState.cursor : (page.cursor ?? syncState.cursor),
          status: decision.status,
          nextRunAt: page.nextPageToken ? now : decision.nextRunAt,
          lastSyncAt: now,
          failureCount: 0,
          ...(syncState.cursor ? {} : { lastFullSyncAt: now }),
        },
      }),
      prisma.connection.update({
        where: { id: connection.id },
        data: { status: 'ACTIVE', lastSyncAt: now, lastErrorMessage: null },
      }),
      prisma.syncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          outcome: page.nextPageToken ? 'PARTIAL' : 'SUCCESS',
          itemsUpdated: page.items.length,
        },
      }),
    ]);

    return {
      connectionId: connection.id,
      resource,
      outcome: page.nextPageToken ? 'PARTIAL' : 'SUCCESS',
      itemsCreated: 0,
      itemsUpdated: page.items.length,
    };
  } catch (error) {
    const connectorError =
      error instanceof ConnectorError
        ? error
        : new ConnectorError('TRANSIENT', error instanceof Error ? error.message : String(error));

    const decision = decideAfterError({
      code: connectorError.code,
      previousFailureCount: syncState.failureCount,
      pollIntervalSeconds: pollInterval,
      retryAfterSeconds: connectorError.retryAfterSeconds,
      now,
    });

    await prisma.$transaction([
      prisma.syncState.update({
        where: { id: syncState.id },
        data: {
          status: decision.status,
          nextRunAt: decision.nextRunAt,
          failureCount: decision.failureCount,
          ...(decision.resetCursor ? { cursor: null } : {}),
        },
      }),
      prisma.connection.update({
        where: { id: connection.id },
        data: {
          ...(decision.connectionStatus ? { status: decision.connectionStatus } : {}),
          lastErrorAt: now,
          lastErrorMessage: connectorError.message,
        },
      }),
      prisma.syncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          outcome: 'FAILED',
          errorMessage: connectorError.message,
        },
      }),
    ]);

    return {
      connectionId: connection.id,
      resource,
      outcome: 'FAILED',
      itemsCreated: 0,
      itemsUpdated: 0,
      errorMessage: connectorError.message,
    };
  }
}

/** Um ciclo do worker: pega o que venceu e executa em sequencia. */
export async function runSyncCycle(now = new Date()): Promise<SyncResult[]> {
  const due = await findDueSyncStates(now);
  const results: SyncResult[] = [];

  for (const syncState of due) {
    // Falha de uma conexao nunca derruba o ciclo das outras: e o que sustenta
    // a degradacao por conexao prometida em docs/00-visao.md.
    results.push(await runSync(syncState, new Date()));
  }

  return results;
}
