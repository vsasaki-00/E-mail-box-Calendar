import type {
  Connector,
  ConnectorCapabilities,
  ConnectorContext,
  FetchOptions,
  Page,
  RawCalendar,
  RawEvent,
  RawMailbox,
  RawMessage,
} from './types';
import { ConnectorError } from './types';
import { ensureGoogleAccessToken } from './google-auth';
import { GOOGLE_TOKEN_ENDPOINT, mapGoogleError } from './google-errors';
import { createPkcePair, type PkcePair } from './pkce';
import { parseContainerCursor, serializeContainerCursor } from './container-cursor';
import {
  encodeMailPageToken,
  decodeMailPageToken,
  normalizeGmailMessage,
  normalizeGoogleEvent,
  labelRole,
  type GmailMessageResource,
  type GmailPart,
  type GoogleEventResource,
} from './google-normalize';

/**
 * Conector Google (Gmail + Google Calendar). Ver docs/03-conectores.md
 *
 * Sync de e-mail: `messages.list` no full sync, `history.list` no incremental.
 * Sync de calendario: `events.list` com `singleEvents=true` (instancias ja
 * expandidas pelo proprio Google) e `syncToken` no incremental.
 */

export { GOOGLE_TOKEN_ENDPOINT, mapGoogleError };

/** Fase 1 e somente leitura. Escrita (gmail.modify) entra na fase 4. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

/** Paginas por chamada de fetch: acima disso devolvemos o controle ao motor. */
const MAIL_PAGE_SIZE = 100;
const CALENDAR_PAGE_SIZE = 250;
/** Teto de paginas por calendario numa unica execucao, contra loop infinito. */
const MAX_CALENDAR_PAGES = 60;
/** Requisicoes simultaneas ao buscar metadados. A quota do Gmail e por unidade. */
const METADATA_CONCURRENCY = 8;

export const googleCapabilities: ConnectorCapabilities = {
  mail: true,
  calendar: true,
  contacts: true,
  incrementalSync: 'history-api',
  push: true,
  serverSideSearch: true,
  write: false,
  pollIntervalSeconds: 300,
};

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

// Reexportados por compatibilidade: o resto do app (e os testes) importam
// PKCE a partir daqui. A implementacao e generica, em ./pkce.
export { createPkcePair, type PkcePair };

export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** Sugere a conta na tela de consentimento, util com varias contas Google. */
  loginHint?: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // access_type=offline + prompt=consent garantem o refresh_token: o Google so
  // devolve refresh_token na primeira autorizacao, a menos que forcemos consent.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------

async function googleGet<T>(
  ctx: ConnectorContext,
  url: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const alvo = new URL(url);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined) alvo.searchParams.set(chave, String(valor));
  }

  const token = await ensureGoogleAccessToken(ctx);
  const response = await fetch(alvo, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw mapGoogleError(response.status, response.headers.get('retry-after'));
  }
  return (await response.json()) as T;
}

/**
 * Executa em lotes com paralelismo limitado.
 * `messages.get` custa quota por unidade, entao disparar centenas de vez leva a
 * 403 e derruba a conexao inteira.
 */
async function emLotes<T, R>(
  itens: T[],
  tamanho: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    resultados.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  }
  return resultados;
}

/** Cabecalhos suficientes para a lista; o corpo continua sob demanda. */
const METADATA_HEADERS = ['Message-ID', 'Subject', 'From', 'To', 'Cc', 'Date'];

async function fetchMessageMetadata(
  ctx: ConnectorContext,
  id: string,
): Promise<GmailMessageResource | null> {
  try {
    const url = new URL(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}`);
    url.searchParams.set('format', 'metadata');
    for (const header of METADATA_HEADERS) url.searchParams.append('metadataHeaders', header);

    const token = await ensureGoogleAccessToken(ctx);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    // A mensagem pode ter sido apagada entre o list e o get: nao e erro de sync.
    if (response.status === 404) return null;
    if (!response.ok) throw mapGoogleError(response.status, response.headers.get('retry-after'));

    return (await response.json()) as GmailMessageResource;
  } catch (error) {
    if (error instanceof ConnectorError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Conector
// ---------------------------------------------------------------------------

export const googleConnector: Connector = {
  provider: 'GOOGLE',
  capabilities: googleCapabilities,

  async verify(ctx) {
    const perfil = await googleGet<{ emailAddress: string }>(ctx, `${GMAIL_BASE}/profile`);
    return { accountEmail: perfil.emailAddress };
  },

  async listMailboxes(ctx): Promise<RawMailbox[]> {
    const resposta = await googleGet<{
      labels?: { id: string; name: string; type?: string }[];
    }>(ctx, `${GMAIL_BASE}/labels`);

    return (resposta.labels ?? []).map((label) => ({
      providerId: label.id,
      name: label.name,
      role: labelRole(label.id),
    }));
  },

  async listCalendars(ctx): Promise<RawCalendar[]> {
    const resposta = await googleGet<{
      items?: {
        id: string;
        summary?: string;
        timeZone?: string;
        backgroundColor?: string;
        primary?: boolean;
        accessRole?: string;
      }[];
    }>(ctx, `${CALENDAR_BASE}/users/me/calendarList`, { maxResults: 250 });

    return (resposta.items ?? []).map((calendario) => ({
      providerId: calendario.id,
      name: calendario.summary ?? calendario.id,
      timezone: calendario.timeZone,
      color: calendario.backgroundColor,
      isPrimary: calendario.primary === true,
      // Fase 1 e somente leitura, mas guardamos o direito real do calendario
      // para a fase 4 nao precisar redescobrir.
      isReadOnly: calendario.accessRole !== 'owner' && calendario.accessRole !== 'writer',
    }));
  },

  async fetchMessages(ctx, options): Promise<Page<RawMessage>> {
    return options.cursor
      ? fetchMessagesIncremental(ctx, options)
      : fetchMessagesFull(ctx, options);
  },

  async fetchEvents(ctx, options): Promise<Page<RawEvent>> {
    const janelaCursor = parseContainerCursor(options.cursor);
    const calendarios = await googleConnector.listCalendars(ctx);

    const itens: RawEvent[] = [];
    const removidos: string[] = [];
    const tokens: Record<string, string> = {};

    for (const calendario of calendarios) {
      const tokenAnterior = janelaCursor[calendario.providerId];
      const resultado = await fetchEventsDoCalendario(
        ctx,
        calendario.providerId,
        tokenAnterior,
        options.window,
      );
      itens.push(...resultado.itens);
      removidos.push(...resultado.removidos);
      if (resultado.syncToken) tokens[calendario.providerId] = resultado.syncToken;
    }

    return {
      items: itens,
      deletedProviderIds: removidos,
      cursor: serializeContainerCursor(tokens),
    };
  },

  async fetchMessageBody(ctx, providerId) {
    const mensagem = await googleGet<GmailMessageResource>(
      ctx,
      `${GMAIL_BASE}/messages/${encodeURIComponent(providerId)}`,
      { format: 'full' },
    );
    return extrairCorpo(mensagem);
  },
};

// ---------------------------------------------------------------------------
// Gmail: full sync
// ---------------------------------------------------------------------------

async function fetchMessagesFull(
  ctx: ConnectorContext,
  options: FetchOptions,
): Promise<Page<RawMessage>> {
  const estado = decodeMailPageToken(options.pageToken);

  // O historyId e capturado ANTES de listar. Peganda-lo no fim perderia tudo
  // que mudou durante o full sync; pegando antes, o incremental reprocessa
  // essas mudancas — e o upsert torna isso inofensivo.
  const historyId =
    estado?.historyId ??
    (await googleGet<{ historyId: string }>(ctx, `${GMAIL_BASE}/profile`)).historyId;

  const dias = Number(process.env.SYNC_MAIL_WINDOW_DAYS ?? 90);
  const lista = await googleGet<{
    messages?: { id: string }[];
    nextPageToken?: string;
  }>(ctx, `${GMAIL_BASE}/messages`, {
    maxResults: options.pageSize ?? MAIL_PAGE_SIZE,
    q: `newer_than:${dias}d`,
    pageToken: estado?.listPageToken,
  });

  const ids = (lista.messages ?? []).map((m) => m.id);
  const detalhes = await emLotes(ids, METADATA_CONCURRENCY, (id) =>
    fetchMessageMetadata(ctx, id),
  );

  return {
    items: detalhes.filter((m): m is GmailMessageResource => m !== null).map(normalizeGmailMessage),
    // O cursor so avanca na ultima pagina: gravar no meio faria um sync
    // interrompido pular as paginas restantes para sempre.
    nextPageToken: lista.nextPageToken
      ? encodeMailPageToken({ listPageToken: lista.nextPageToken, historyId })
      : undefined,
    cursor: lista.nextPageToken ? undefined : historyId,
  };
}

// ---------------------------------------------------------------------------
// Gmail: incremental via history API
// ---------------------------------------------------------------------------

interface HistoryRecord {
  messagesAdded?: { message: { id: string } }[];
  messagesDeleted?: { message: { id: string } }[];
  labelsAdded?: { message: { id: string } }[];
  labelsRemoved?: { message: { id: string } }[];
}

async function fetchMessagesIncremental(
  ctx: ConnectorContext,
  options: FetchOptions,
): Promise<Page<RawMessage>> {
  let resposta: { history?: HistoryRecord[]; nextPageToken?: string; historyId?: string };

  try {
    resposta = await googleGet(ctx, `${GMAIL_BASE}/history`, {
      startHistoryId: options.cursor,
      maxResults: MAIL_PAGE_SIZE,
      pageToken: options.pageToken,
    });
  } catch (error) {
    // O Gmail responde 404 quando o startHistoryId ja saiu da janela de
    // historico. Isso e cursor expirado, nao recurso inexistente: o motor
    // precisa cair para full sync em vez de tratar como falha.
    if (error instanceof ConnectorError && error.code === 'NOT_FOUND') {
      throw new ConnectorError(
        'CURSOR_EXPIRED',
        'historyId do Gmail fora da janela de historico; requer full sync',
      );
    }
    throw error;
  }

  const alterados = new Set<string>();
  const removidos = new Set<string>();

  for (const registro of resposta.history ?? []) {
    for (const item of registro.messagesAdded ?? []) alterados.add(item.message.id);
    // Mudanca de label altera flags (lido, arquivado): precisa rebuscar.
    for (const item of registro.labelsAdded ?? []) alterados.add(item.message.id);
    for (const item of registro.labelsRemoved ?? []) alterados.add(item.message.id);
    for (const item of registro.messagesDeleted ?? []) removidos.add(item.message.id);
  }

  // Uma mensagem apagada nao deve ser rebuscada so porque ganhou label antes.
  for (const id of removidos) alterados.delete(id);

  const detalhes = await emLotes([...alterados], METADATA_CONCURRENCY, (id) =>
    fetchMessageMetadata(ctx, id),
  );

  return {
    items: detalhes.filter((m): m is GmailMessageResource => m !== null).map(normalizeGmailMessage),
    deletedProviderIds: [...removidos],
    nextPageToken: resposta.nextPageToken,
    cursor: resposta.nextPageToken ? undefined : resposta.historyId,
  };
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

async function fetchEventsDoCalendario(
  ctx: ConnectorContext,
  calendarId: string,
  syncTokenAnterior: string | undefined,
  janela: FetchOptions['window'],
): Promise<{ itens: RawEvent[]; removidos: string[]; syncToken?: string }> {
  const itens: RawEvent[] = [];
  const removidos: string[] = [];

  let pageToken: string | undefined;
  let syncToken = syncTokenAnterior;
  let paginas = 0;

  do {
    let resposta: {
      items?: GoogleEventResource[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    try {
      resposta = await googleGet(
        ctx,
        `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          maxResults: CALENDAR_PAGE_SIZE,
          // singleEvents=true entrega as ocorrencias ja expandidas pelo Google.
          // Expandir RRULE com excecoes e DST por conta propria e uma fonte
          // inesgotavel de bugs. Ver docs/02-modelo-de-dados.md
          singleEvents: true,
          showDeleted: syncTokenAnterior ? true : undefined,
          pageToken,
          // A API rejeita timeMin/timeMax junto com syncToken.
          ...(syncTokenAnterior
            ? { syncToken: syncTokenAnterior }
            : {
                orderBy: 'startTime',
                timeMin: (janela?.since ?? janelaPadrao().since).toISOString(),
                timeMax: (janela?.until ?? janelaPadrao().until).toISOString(),
              }),
        },
      );
    } catch (error) {
      // 410 significa syncToken invalidado pelo Google.
      if (error instanceof ConnectorError && error.code === 'CURSOR_EXPIRED') throw error;
      throw error;
    }

    for (const evento of resposta.items ?? []) {
      if (evento.status === 'cancelled' && !evento.start) {
        // Cancelado sem horario = removido de verdade no incremental.
        removidos.push(evento.id);
        continue;
      }
      const normalizado = normalizeGoogleEvent(evento, calendarId, ctx.accountEmail);
      if (normalizado) itens.push(normalizado);
    }

    pageToken = resposta.nextPageToken;
    if (resposta.nextSyncToken) syncToken = resposta.nextSyncToken;
    paginas += 1;
  } while (pageToken && paginas < MAX_CALENDAR_PAGES);

  if (pageToken) {
    throw new ConnectorError(
      'TRANSIENT',
      `Calendario ${calendarId} excedeu ${MAX_CALENDAR_PAGES} paginas numa execucao; ` +
        'reduza SYNC_CALENDAR_FUTURE_MONTHS',
    );
  }

  return { itens, removidos, syncToken };
}

function janelaPadrao(): { since: Date; until: Date } {
  const mesesPassado = Number(process.env.SYNC_CALENDAR_PAST_MONTHS ?? 1);
  const mesesFuturo = Number(process.env.SYNC_CALENDAR_FUTURE_MONTHS ?? 12);

  const since = new Date();
  since.setMonth(since.getMonth() - mesesPassado);
  const until = new Date();
  until.setMonth(until.getMonth() + mesesFuturo);

  return { since, until };
}

// ---------------------------------------------------------------------------
// Corpo da mensagem (sob demanda)
// ---------------------------------------------------------------------------

/** Percorre a arvore MIME procurando texto e HTML. */
export function extrairCorpo(mensagem: { payload?: GmailPart }): {
  text?: string;
  html?: string;
} {
  let text: string | undefined;
  let html: string | undefined;

  const visitar = (parte: GmailPart | undefined): void => {
    if (!parte) return;
    const dados = parte.body?.data;
    if (dados) {
      const conteudo = Buffer.from(dados, 'base64url').toString('utf8');
      if (parte.mimeType === 'text/plain' && !text) text = conteudo;
      else if (parte.mimeType === 'text/html' && !html) html = conteudo;
    }
    for (const filha of parte.parts ?? []) visitar(filha);
  };

  visitar(mensagem.payload);
  return { text, html };
}
