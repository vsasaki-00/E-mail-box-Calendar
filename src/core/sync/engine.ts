import type { Connection, SyncState } from '@prisma/client';
import { prisma } from '@/lib/db';
import { decryptSecret, encryptSecret, keyringFromEnv, type Keyring } from '@/lib/crypto';
import { getConnector } from '@/lib/connectors/registry';
import {
  ConnectorError,
  type Connector,
  type ConnectorContext,
  type ConnectorCredentials,
} from '@/lib/connectors/types';
import { decideAfterError, decideAfterSuccess } from './backoff';
import { podeIniciarRecurso } from './orcamento';
import { intercalarPorConexao } from './escolha-recurso';
import {
  persistCalendars,
  persistEvents,
  persistMailboxes,
  persistMessages,
  type PersistCounts,
} from './persist';

/**
 * Motor de sincronizacao. Ver ADR-3 em docs/01-arquitetura.md
 *
 * Responsabilidades: escolher o que esta vencido, montar o contexto do conector
 * (decifrando credenciais), executar, persistir e traduzir o resultado em
 * cursor + estado. Nao conhece nenhum provedor: tudo passa pela interface
 * Connector e pelas capacidades que ela declara.
 */

export interface SyncResult {
  connectionId: string;
  resource: 'MAIL' | 'CALENDAR' | 'CONTACTS';
  outcome: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  counts: PersistCounts;
  errorMessage?: string;
}

const SEM_ALTERACOES: PersistCounts = { created: 0, updated: 0, deleted: 0, skippedUnknownContainer: 0 };

/**
 * O que conta como vencido. Uma definicao so, usada para buscar e para
 * contar: se as duas divergissem, o ciclo diria "acabou" com trabalho
 * sobrando, ou pediria mais uma volta para sempre.
 */
function filtroVencidos(now: Date) {
  return {
    OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    connection: { status: { notIn: ['DISABLED' as const, 'REAUTH_REQUIRED' as const] } },
  };
}

/** Estados vencidos, prontos para rodar. Conexoes desativadas ficam de fora. */
export async function findDueSyncStates(now = new Date(), limit = 20) {
  return prisma.syncState.findMany({
    where: filtroVencidos(now),
    orderBy: { nextRunAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    include: { connection: true },
  });
}

/**
 * Quantos recursos continuam vencidos.
 *
 * E o que permite um disparo externo saber se precisa chamar de novo. Sem
 * isso, quem agenda de fora so pode chutar um numero de voltas — e chutar
 * para baixo deixa caixa pela metade, chutar para cima gasta execucao a toa.
 */
export async function contarSyncStatesVencidos(now = new Date()): Promise<number> {
  return prisma.syncState.count({ where: filtroVencidos(now) });
}

/** Grava credenciais renovadas, sempre cifradas. Nunca em claro, nunca em log. */
export async function saveCredentials(
  connectionId: string,
  credentials: ConnectorCredentials,
  keyring: Keyring,
): Promise<void> {
  const cifrado = encryptSecret(JSON.stringify(credentials), keyring);
  await prisma.connection.update({
    where: { id: connectionId },
    data: {
      secretCiphertext: cifrado.ciphertext,
      secretIv: cifrado.iv,
      secretTag: cifrado.tag,
      secretKeyId: cifrado.keyId,
      tokenExpiresAt: credentials.expiresAt ?? null,
    },
  });
}

export function readCredentials(
  connection: Connection,
  keyring: Keyring,
): ConnectorCredentials {
  if (!connection.secretCiphertext || !connection.secretIv || !connection.secretTag) {
    throw new ConnectorError('AUTH_EXPIRED', 'Conexao sem credenciais; reconecte a conta');
  }

  const plaintext = decryptSecret(
    {
      ciphertext: connection.secretCiphertext,
      iv: connection.secretIv,
      tag: connection.secretTag,
      keyId: connection.secretKeyId ?? keyring.currentKeyId,
    },
    keyring,
  );

  const credentials = JSON.parse(plaintext) as ConnectorCredentials;
  // O JSON nao preserva Date; sem isso o refresh proativo nunca dispararia.
  return {
    ...credentials,
    expiresAt: credentials.expiresAt ? new Date(credentials.expiresAt) : undefined,
  };
}

export function buildContext(connection: Connection, keyring: Keyring): ConnectorContext {
  return {
    connectionId: connection.id,
    accountEmail: connection.accountEmail,
    credentials: readCredentials(connection, keyring),
    config: (connection.config as Record<string, unknown>) ?? {},
    // O conector renovou o token no meio da execucao: persistimos na hora, para
    // a proxima execucao nao gastar outro refresh.
    onCredentialsRefreshed: (credentials) =>
      saveCredentials(connection.id, credentials, keyring),
  };
}

/**
 * Garante que pastas e calendarios existem antes de gravar itens.
 *
 * Roda no full sync (sem cursor) e sempre que um item chega apontando para um
 * container desconhecido — um calendario novo assinado depois da conexao, por
 * exemplo, nao pode ficar invisivel ate o proximo full sync.
 */
async function descobrirContainers(
  connector: Connector,
  ctx: ConnectorContext,
  connectionId: string,
  resource: 'MAIL' | 'CALENDAR',
): Promise<Map<string, string>> {
  if (resource === 'MAIL') {
    if (!connector.capabilities.mail) return new Map();
    return persistMailboxes(connectionId, await connector.listMailboxes(ctx));
  }
  if (!connector.capabilities.calendar) return new Map();
  return persistCalendars(connectionId, await connector.listCalendars(ctx));
}

async function containersConhecidos(
  connectionId: string,
  resource: 'MAIL' | 'CALENDAR',
): Promise<Map<string, string>> {
  const registros =
    resource === 'MAIL'
      ? await prisma.mailbox.findMany({
          where: { connectionId },
          select: { id: true, providerId: true },
        })
      : await prisma.calendarSource.findMany({
          where: { connectionId },
          select: { id: true, providerId: true },
        });

  return new Map(registros.map((registro) => [registro.providerId, registro.id]));
}

/**
 * Quanto tempo uma execucao segura o recurso para si.
 *
 * Curto o bastante para o recurso voltar a ser tentado dentro da mesma janela
 * de sincronizacao (o laco do agendamento roda ate 15 min), e longo o
 * bastante para nao voltar na chamada seguinte e travar tudo de novo.
 */
export const ARRENDAMENTO_MS = 10 * 60_000;

/**
 * Marca o recurso como "sendo executado agora", empurrando o `nextRunAt`.
 *
 * O sucesso e a falha regravam esse campo logo em seguida, entao o
 * arrendamento so vale de fato quando a execucao morre SEM ESCREVER NADA — o
 * caso da funcao serverless morta no limite de 60s da Vercel.
 *
 * Sem ele, o recurso morto continua com `nextRunAt` no passado, volta a ser o
 * MAIS VENCIDO da fila na chamada seguinte e e escolhido primeiro outra vez.
 * Para sempre. Foi o que aconteceu em producao: um recurso que nao cabe em
 * 60s travou a cabeca da fila e cinco caixas ficaram 12 h sem sincronizar.
 * Com o arrendamento, quem nao termina espera a vez como todo mundo, em vez
 * de bloquear a fila inteira.
 */
export async function arrendarRecurso(syncStateId: string, now = new Date()): Promise<void> {
  await prisma.syncState.update({
    where: { id: syncStateId },
    data: { status: 'RUNNING', nextRunAt: new Date(now.getTime() + ARRENDAMENTO_MS) },
  });
}

/**
 * Executa um recurso de uma conexao e persiste o resultado.
 *
 * O SyncRun e aberto antes e fechado sempre — inclusive em falha — porque e ele
 * que responde "por que a agenda esta desatualizada?" no painel de saude.
 */
export async function runSync(
  syncState: SyncState & { connection: Connection },
  now = new Date(),
  prazoEm?: number,
): Promise<SyncResult> {
  const { connection, resource } = syncState;
  const connector = getConnector(connection.provider);
  const pollInterval = connector.capabilities.pollIntervalSeconds;

  if (resource === 'CONTACTS') {
    // Contatos entram na fase 5; nao ha o que fazer, mas tambem nao e erro.
    return { connectionId: connection.id, resource, outcome: 'SUCCESS', counts: SEM_ALTERACOES };
  }

  const run = await prisma.syncRun.create({
    data: { connectionId: connection.id, resource, startedAt: now },
  });

  await arrendarRecurso(syncState.id, now);

  try {
    const keyring = keyringFromEnv();
    const context = buildContext(connection, keyring);
    const ehFullSync = !syncState.cursor;

    let containers = ehFullSync
      ? await descobrirContainers(connector, context, connection.id, resource)
      : await containersConhecidos(connection.id, resource);

    // Cursor ausente = full sync da janela; presente = incremental.
    const opcoes = {
      cursor: syncState.cursor ?? undefined,
      pageToken: syncState.pageToken ?? undefined,
    };
    const page =
      resource === 'MAIL'
        ? await connector.fetchMessages(context, opcoes)
        : await connector.fetchEvents(context, opcoes);

    // Item apontando para um container que ainda nao conheciamos: redescobre
    // uma vez, em vez de descartar o item silenciosamente.
    const desconhecido =
      resource === 'MAIL'
        ? page.items.some(
            (item) =>
              'mailboxProviderId' in item &&
              item.mailboxProviderId &&
              !containers.has(item.mailboxProviderId),
          )
        : page.items.some(
            (item) => 'calendarProviderId' in item && !containers.has(item.calendarProviderId),
          );

    if (desconhecido && !ehFullSync) {
      containers = await descobrirContainers(connector, context, connection.id, resource);
    }

    const counts =
      resource === 'MAIL'
        ? await persistMessages({
            connectionId: connection.id,
            userId: connection.userId,
            mensagens: page.items as never,
            removidos: page.deletedProviderIds,
            mailboxIdPorProviderId: containers,
            prazoEm,
          })
        : await persistEvents({
            connectionId: connection.id,
            userId: connection.userId,
            eventos: page.items as never,
            removidos: page.deletedProviderIds,
            calendarIdPorProviderId: containers,
            prazoEm,
          });

    // Gravacao interrompida conta como parcial: avancar o cursor com metade
    // da pagina gravada perderia a outra metade para sempre. Parcial faz a
    // proxima volta refazer a pagina — e refazer e barato, porque toda
    // escrita e upsert por chave do provedor.
    const parcial = Boolean(page.nextPageToken) || Boolean(counts.interrompido);
    const decisao = decideAfterSuccess(pollInterval, now);

    await prisma.$transaction([
      prisma.syncState.update({
        where: { id: syncState.id },
        data: {
          // O cursor so avanca ao terminar a paginacao: grava-lo no meio faria
          // um sync interrompido pular as paginas restantes para sempre.
          cursor: parcial ? syncState.cursor : (page.cursor ?? syncState.cursor),
          pageToken: page.nextPageToken ?? null,
          status: decisao.status,
          // Continuacao de paginacao roda imediatamente, sem esperar o intervalo.
          nextRunAt: parcial ? now : decisao.nextRunAt,
          lastSyncAt: now,
          failureCount: 0,
          ...(ehFullSync && !parcial ? { lastFullSyncAt: now } : {}),
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
          outcome: parcial ? 'PARTIAL' : 'SUCCESS',
          itemsCreated: counts.created,
          itemsUpdated: counts.updated,
          itemsDeleted: counts.deleted,
        },
      }),
    ]);

    return {
      connectionId: connection.id,
      resource,
      outcome: parcial ? 'PARTIAL' : 'SUCCESS',
      counts,
    };
  } catch (error) {
    const connectorError =
      error instanceof ConnectorError
        ? error
        : new ConnectorError('TRANSIENT', error instanceof Error ? error.message : String(error));

    const decisao = decideAfterError({
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
          status: decisao.status,
          nextRunAt: decisao.nextRunAt,
          failureCount: decisao.failureCount,
          // Cursor expirado tambem descarta a paginacao em andamento: ela
          // pertencia ao cursor antigo.
          ...(decisao.resetCursor ? { cursor: null, pageToken: null } : {}),
        },
      }),
      prisma.connection.update({
        where: { id: connection.id },
        data: {
          ...(decisao.connectionStatus ? { status: decisao.connectionStatus } : {}),
          lastErrorAt: now,
          lastErrorMessage: connectorError.message,
        },
      }),
      prisma.syncRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), outcome: 'FAILED', errorMessage: connectorError.message },
      }),
    ]);

    return {
      connectionId: connection.id,
      resource,
      outcome: 'FAILED',
      counts: SEM_ALTERACOES,
      errorMessage: connectorError.message,
    };
  }
}

export interface CicloOptions {
  /**
   * Para de INICIAR recursos novos depois deste tempo. O que ja comecou
   * termina — cortar no meio perderia a pagina em andamento.
   *
   * Existe por causa da funcao serverless: 12 recursos em sequencia, cada um
   * conversando com Gmail ou Graph, passam dos 60s do plano Hobby com folga,
   * e ai a plataforma responde uma pagina de texto no lugar do JSON e o
   * ciclo inteiro se perde. Com orcamento, cada disparo entrega o que deu e
   * diz que ainda ha trabalho. Sem orcamento (o worker local), roda tudo.
   */
  orcamentoMs?: number;

  /**
   * Instante (epoch ms) a partir do qual a GRAVACAO para no meio da pagina.
   *
   * O orcamento acima impede comecar recurso novo, mas nao ajuda com o
   * recurso que ja comecou — e gravar uma pagina no Postgres pode custar mais
   * que busca-la. Este e o freio de dentro: para de gravar, marca a volta
   * como parcial, e a proxima refaz a pagina (upsert, entao refazer e
   * barato). Sem ele, a unica coisa que interrompia o trabalho era a
   * plataforma matar a funcao — que e onde nasceram os 504.
   */
  prazoDeGravacaoEm?: number;
}

/** Um ciclo do worker: pega o que venceu e executa em sequencia. */
export async function runSyncCycle(
  now = new Date(),
  options: CicloOptions = {},
): Promise<SyncResult[]> {
  // Intercalado por conta: com orcamento apertado, a ordem pura de "mais
  // vencido" deixa uma conta consumir as vagas todas. Ver
  // `intercalarPorConexao`.
  const due = intercalarPorConexao(await findDueSyncStates(now));
  const results: SyncResult[] = [];
  const prazo = options.orcamentoMs === undefined ? undefined : Date.now() + options.orcamentoMs;

  for (const syncState of due) {
    if (!podeIniciarRecurso(results.length, prazo, Date.now())) break;

    // Falha de uma conexao nunca derruba o ciclo das outras: e o que sustenta
    // a degradacao por conexao prometida em docs/00-visao.md.
    results.push(await runSync(syncState, new Date(), options.prazoDeGravacaoEm));
  }

  return results;
}

/** Enfileira um sync imediato de todos os recursos de uma conexao. */
export async function agendarSyncImediato(connectionId: string): Promise<void> {
  await prisma.syncState.updateMany({
    where: { connectionId },
    data: { nextRunAt: new Date() },
  });
}
