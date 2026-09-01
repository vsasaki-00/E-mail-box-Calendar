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
  RawAttachment,
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
import { envNumero } from '@/lib/env';

/**
 * Conector Google (Gmail + Google Calendar). Ver docs/03-conectores.md
 *
 * Sync de e-mail: `messages.list` no full sync, `history.list` no incremental.
 * Sync de calendario: `events.list` com `singleEvents=true` (instancias ja
 * expandidas pelo proprio Google) e `syncToken` no incremental.
 */

export { GOOGLE_TOKEN_ENDPOINT, mapGoogleError };

/**
 * Escopos de LEITURA. E com estes que toda conexao nasce.
 *
 * Continuam sendo o padrao mesmo depois da fase 4: escrita e um
 * consentimento separado, por caixa, e quem nao pedir continua com uma
 * conexao que nao consegue escrever nem por engano.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

/**
 * Escopos de ESCRITA (fase 4). Ver docs/08-escrita-e-acoes.md
 *
 * `gmail.modify` e nao `mail.google.com`: o primeiro permite arquivar,
 * marcar lido, aplicar label e ENVIAR, mas **nao permite excluir
 * definitivamente**. O escopo mais amplo daria o poder de apagar, que este
 * app nao usa e por isso nao pede — pedir permissao que nao se usa e como
 * deixar a chave reserva embaixo do tapete.
 */
export const GOOGLE_WRITE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  // `calendar.readonly` PRECISA continuar aqui, ao lado de
  // `calendar.events`.
  //
  // `calendar.events` cobre ler e escrever EVENTOS, mas nao da acesso a
  // `users/me/calendarList` — e listar os calendarios e o primeiro passo de
  // todo sync de agenda. Sem este escopo, autorizar escrita numa caixa
  // QUEBRAVA a sincronizacao do calendario dela por inteiro, com um 403
  // "insufficient authentication scopes"; a agenda ficava vazia e o e-mail
  // continuava chegando, o que escondia a relacao de causa.
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
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
  // Fase 4. A capacidade existir NAO significa que uma conexao pode
  // escrever: cada conexao carrega o proprio `writeEnabled`, que so fica
  // verdadeiro depois de voce reautorizar aquela caixa.
  write: true,
  attachments: true,
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
  /**
   * Pedir escopos de ESCRITA. Falso por padrao — de proposito: um flag que
   * precisa ser ligado explicitamente nao vira escrita por acidente.
   */
  write?: boolean;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set(
    'scope',
    (params.write ? GOOGLE_WRITE_SCOPES : GOOGLE_SCOPES).join(' '),
  );
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // access_type=offline + prompt=consent garantem o refresh_token: o Google so
  // devolve refresh_token na primeira autorizacao, a menos que forcemos consent.
  //
  // `select_account` junto porque este app existe para ligar VARIAS caixas.
  // Sem ele, o Google reusa a conta ativa no navegador em silencio, e a
  // segunda conexao acabaria gravando de novo a primeira conta.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
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
    // Le o corpo ANTES de descartar: e nele que o Google diz o motivo.
    const corpoErro = await response.text().catch(() => undefined);
    throw mapGoogleError(response.status, response.headers.get('retry-after'), corpoErro);
  }
  return (await response.json()) as T;
}

/** POST autenticado. So usado pelas acoes de escrita da fase 4. */
async function googlePost<T>(ctx: ConnectorContext, url: string, corpo: unknown): Promise<T> {
  const token = await ensureGoogleAccessToken(ctx);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });

  if (!response.ok) {
    // Le o corpo ANTES de descartar: e nele que o Google diz o motivo.
    const corpoErro = await response.text().catch(() => undefined);
    throw mapGoogleError(response.status, response.headers.get('retry-after'), corpoErro);
  }
  // Algumas rotas devolvem 204 sem corpo.
  const texto = await response.text();
  return (texto ? JSON.parse(texto) : {}) as T;
}

/** PATCH autenticado, para mover evento. */
async function googlePatch<T>(ctx: ConnectorContext, url: string, corpo: unknown): Promise<T> {
  const token = await ensureGoogleAccessToken(ctx);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });

  if (!response.ok) {
    // Le o corpo ANTES de descartar: e nele que o Google diz o motivo.
    const corpoErro = await response.text().catch(() => undefined);
    throw mapGoogleError(response.status, response.headers.get('retry-after'), corpoErro);
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

  /**
   * Anexos do Gmail vem em DUAS chamadas: a estrutura da mensagem traz o
   * `attachmentId` de cada parte, e o conteudo vem de
   * `messages/{id}/attachments/{attachmentId}`.
   */
  async fetchAttachments(ctx, providerId, options) {
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
    const mensagem = await googleGet<GmailMessageResource>(
      ctx,
      `${GMAIL_BASE}/messages/${encodeURIComponent(providerId)}`,
      { format: 'full' },
    );

    const anexos: RawAttachment[] = [];
    for (const parte of listarPartesComAnexo(mensagem.payload)) {
      const id = parte.body?.attachmentId;
      if (!id) continue;
      // O tamanho ja vem na estrutura: da para recusar ANTES de baixar.
      if ((parte.body?.size ?? 0) > maxBytes) continue;

      const dado = await googleGet<{ data?: string; size?: number }>(
        ctx,
        `${GMAIL_BASE}/messages/${encodeURIComponent(providerId)}/attachments/${encodeURIComponent(id)}`,
      );
      if (!dado.data) continue;

      anexos.push({
        providerId: id,
        filename: parte.filename ?? 'anexo',
        mimeType: parte.mimeType ?? 'application/octet-stream',
        size: dado.size ?? 0,
        // Gmail devolve base64url, nao base64 padrao.
        data: new Uint8Array(Buffer.from(dado.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      });
    }
    return anexos;
  },

  // --- Fase 4: escrita. Ver docs/08-escrita-e-acoes.md ---

  /**
   * Arquivar no Gmail e remover o label INBOX. A mensagem continua
   * existindo e volta com `unarchiveMessage` — nada e apagado.
   */
  async archiveMessage(ctx, providerId) {
    await googlePost(ctx, `${GMAIL_BASE}/messages/${encodeURIComponent(providerId)}/modify`, {
      removeLabelIds: ['INBOX'],
    });
  },

  async unarchiveMessage(ctx, providerId) {
    await googlePost(ctx, `${GMAIL_BASE}/messages/${encodeURIComponent(providerId)}/modify`, {
      addLabelIds: ['INBOX'],
    });
  },

  async setMessageRead(ctx, providerId, read) {
    // No Gmail "nao lido" e a PRESENCA do label UNREAD.
    await googlePost(ctx, `${GMAIL_BASE}/messages/${encodeURIComponent(providerId)}/modify`, {
      [read ? 'removeLabelIds' : 'addLabelIds']: ['UNREAD'],
    });
  },

  async setMessageLabel(ctx, providerId, labelId, apply) {
    await googlePost(ctx, `${GMAIL_BASE}/messages/${encodeURIComponent(providerId)}/modify`, {
      [apply ? 'addLabelIds' : 'removeLabelIds']: [labelId],
    });
  },

  async respondToEvent(ctx, ref, response) {
    const mapa = { ACCEPTED: 'accepted', DECLINED: 'declined', TENTATIVE: 'tentative' } as const;
    const calendario = ref.calendarProviderId;
    const evento = ref.eventProviderId;

    // O Google nao tem rota de RSVP: e um PATCH marcando o proprio usuario
    // como respondido dentro da lista de participantes.
    const atual = await googleGet<{ attendees?: { email?: string; self?: boolean }[] }>(
      ctx,
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendario)}/events/${encodeURIComponent(evento)}`,
    );

    const attendees = (atual.attendees ?? []).map((a) =>
      a.self ? { ...a, responseStatus: mapa[response] } : a,
    );

    await googlePatch(
      ctx,
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendario)}/events/${encodeURIComponent(evento)}`,
      { attendees },
    );
  },

  async moveEvent(ctx, ref, startsAt, endsAt) {
    const calendario = ref.calendarProviderId;
    const evento = ref.eventProviderId;
    const rota = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendario)}/events/${encodeURIComponent(evento)}`;

    // Le ANTES de mover: sem o horario anterior nao ha como desfazer.
    const atual = await googleGet<{
      start?: { dateTime?: string };
      end?: { dateTime?: string };
    }>(ctx, rota);

    await googlePatch(ctx, rota, {
      start: { dateTime: startsAt.toISOString() },
      end: { dateTime: endsAt.toISOString() },
    });

    return {
      previousStartsAt: new Date(atual.start?.dateTime ?? startsAt),
      previousEndsAt: new Date(atual.end?.dateTime ?? endsAt),
    };
  },

  async createEvent(ctx, event) {
    const criado = await googlePost<{ id?: string }>(
      ctx,
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(event.calendarProviderId)}/events`,
      {
        summary: event.title,
        description: event.description,
        start: { dateTime: event.startsAt.toISOString() },
        end: { dateTime: event.endsAt.toISOString() },
        attendees: event.attendees?.map((email) => ({ email })),
      },
    );
    return { providerId: criado.id ?? '' };
  },

  async sendReply(ctx, reply) {
    // O Gmail recebe a mensagem inteira em RFC 5322, codificada em
    // base64url. `threadId` e o que mantem a resposta na mesma conversa.
    const original = await googleGet<{ threadId?: string; payload?: GmailPart }>(
      ctx,
      `${GMAIL_BASE}/messages/${encodeURIComponent(reply.inReplyToProviderId)}`,
      { format: 'metadata' },
    );

    const bruto = Buffer.from(montarRfc822(reply), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const enviado = await googlePost<{ id?: string }>(ctx, `${GMAIL_BASE}/messages/send`, {
      raw: bruto,
      threadId: original.threadId,
    });
    return { providerId: enviado.id ?? '' };
  },
};

/** Monta a mensagem RFC 5322 do envio. */
function montarRfc822(reply: {
  to: string[];
  subject: string;
  bodyText: string;
  inReplyToProviderId: string;
}): string {
  return [
    `To: ${reply.to.join(', ')}`,
    `Subject: ${reply.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    reply.bodyText,
  ].join('\r\n');
}

/** Limite padrao por anexo. Ver docs/07: PDF de boleto tem dezenas de KB. */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Partes que sao anexo de verdade: tem nome de arquivo e id de anexo. */
function listarPartesComAnexo(raiz?: GmailPart): GmailPart[] {
  const saida: GmailPart[] = [];
  const visitar = (parte?: GmailPart) => {
    if (!parte) return;
    if (parte.filename && parte.body?.attachmentId) saida.push(parte);
    for (const filha of parte.parts ?? []) visitar(filha);
  };
  visitar(raiz);
  return saida;
}

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

  const dias = envNumero(process.env.SYNC_MAIL_WINDOW_DAYS, 90);
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
  const mesesPassado = envNumero(process.env.SYNC_CALENDAR_PAST_MONTHS, 1);
  const mesesFuturo = envNumero(process.env.SYNC_CALENDAR_FUTURE_MONTHS, 12);

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
