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
import { ensureMicrosoftAccessToken, fetchMicrosoftAccountEmail } from './microsoft-auth';
import { MICROSOFT_TOKEN_ENDPOINT_BASE, mapMicrosoftError } from './microsoft-errors';
import { createPkcePair, type PkcePair } from './pkce';
import { parseContainerCursor, serializeContainerCursor } from './container-cursor';
import {
  DEFAULT_SYNCED_FOLDER_ALIASES,
  folderRole,
  normalizeGraphEvent,
  normalizeGraphMessage,
  type GraphEventResource,
  type GraphMessageResource,
} from './microsoft-normalize';

/**
 * Conector Microsoft (Outlook Mail + Calendar via Graph). Ver docs/03-conectores.md
 *
 * Sync de e-mail: por pasta (Graph nao tem uma lista unica "todas as pastas"
 * como o Gmail), com `messages/delta` por pasta. Sync de calendario:
 * `calendarView/delta`, que devolve instancias ja expandidas dentro de uma
 * janela, igual ao `singleEvents=true` do Google.
 *
 * `common` como tenant aceita tanto conta pessoal (Hotmail/Outlook.com/Live)
 * quanto conta corporativa ou escolar (Azure AD) com o mesmo fluxo.
 */

export { createPkcePair, type PkcePair };

/** Escopos de LEITURA. Toda conexao nasce com estes. */
export const MICROSOFT_SCOPES = [
  'Mail.Read',
  'Calendars.Read',
  'User.Read',
  'offline_access',
] as const;

/**
 * Escopos de ESCRITA (fase 4). Ver docs/08-escrita-e-acoes.md
 *
 * `Mail.ReadWrite` cobre arquivar, marcar lido e mover pasta; `Mail.Send`
 * cobre o envio. Nao pedimos nada alem do que as acoes do catalogo usam.
 */
export const MICROSOFT_WRITE_SCOPES = [
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.ReadWrite',
  'User.Read',
  'offline_access',
] as const;

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Paginas por container numa unica execucao, contra loop infinito. */
const MAX_PAGES_PER_CONTAINER = 60;
const MAIL_PAGE_SIZE = 50;
const CALENDAR_PAGE_SIZE = 100;

const MESSAGE_SELECT = [
  'id',
  'conversationId',
  'internetMessageId',
  'subject',
  'bodyPreview',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'isRead',
  'flag',
  'hasAttachments',
].join(',');

const EVENT_SELECT = [
  'id',
  'iCalUId',
  'seriesMasterId',
  'subject',
  'bodyPreview',
  'location',
  'isAllDay',
  'isCancelled',
  'start',
  'end',
  'organizer',
  'attendees',
  'onlineMeeting',
  'onlineMeetingUrl',
  'responseStatus',
].join(',');

export const microsoftCapabilities: ConnectorCapabilities = {
  mail: true,
  calendar: true,
  contacts: true,
  incrementalSync: 'delta-token',
  push: true,
  serverSideSearch: true,
  // Fase 4. Ver a nota no conector Google: capacidade e do CONECTOR,
  // permissao e da CONEXAO.
  write: true,
  attachments: true,
  pollIntervalSeconds: 300,
};

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function buildMicrosoftAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** "common" aceita contas pessoais (Hotmail/Outlook.com) e corporativas. */
  tenant?: string;
  /** Pedir escopos de ESCRITA. Falso por padrao. */
  write?: boolean;
}): string {
  const tenant = params.tenant || 'common';
  const url = new URL(`${MICROSOFT_TOKEN_ENDPOINT_BASE}/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set(
    'scope',
    (params.write ? MICROSOFT_WRITE_SCOPES : MICROSOFT_SCOPES).join(' '),
  );
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Sem isto o SSO da Microsoft reusa a sessao ativa do navegador e pula a
  // escolha de conta — quem tem sessao corporativa aberta nunca consegue
  // conectar a conta pessoal. Descoberto no primeiro uso real (o Google
  // tinha o mesmo defeito, com `select_account` na mesma solucao).
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export { mapMicrosoftError };

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------

/** Segue uma URL do Graph verbatim (usada para @odata.nextLink/deltaLink, que ja vem com query embutida). */
async function graphFetch<T>(
  ctx: ConnectorContext,
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const token = await ensureMicrosoftAccessToken(ctx);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
  });

  if (!response.ok) {
    throw mapMicrosoftError(response.status, response.headers.get('retry-after'));
  }
  return (await response.json()) as T;
}

async function graphGet<T>(
  ctx: ConnectorContext,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const alvo = new URL(`${GRAPH_BASE}${path}`);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined) alvo.searchParams.set(chave, String(valor));
  }
  return graphFetch<T>(ctx, alvo.toString(), extraHeaders);
}

/**
 * Escrita no Graph. Um so helper para POST/PATCH: as duas rotas diferem
 * pelo verbo, nao pelo tratamento de erro nem pela autenticacao.
 */
async function graphWrite<T>(
  ctx: ConnectorContext,
  method: 'POST' | 'PATCH',
  path: string,
  corpo?: unknown,
): Promise<T> {
  const token = await ensureMicrosoftAccessToken(ctx);
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  if (!response.ok) {
    throw mapMicrosoftError(response.status, response.headers.get('retry-after'));
  }
  // Varias rotas de acao devolvem 202/204 sem corpo.
  const texto = await response.text();
  return (texto ? JSON.parse(texto) : {}) as T;
}

interface GraphDeltaPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

// ---------------------------------------------------------------------------
// Pastas de e-mail (mailFolders)
// ---------------------------------------------------------------------------

interface GraphFolder {
  id: string;
  displayName: string;
}

/**
 * Resolve os aliases bem-conhecidos (`/me/mailFolders/inbox`, etc.) em vez de
 * listar e casar por `displayName`, que e localizado e quebraria em uma caixa
 * em portugues, alemao etc. Ver microsoft-normalize.ts.
 */
type FolderAlias = (typeof DEFAULT_SYNCED_FOLDER_ALIASES)[number];

async function resolveWellKnownFolders(
  ctx: ConnectorContext,
): Promise<{ alias: FolderAlias; folder: GraphFolder }[]> {
  const resultados = await Promise.all(
    DEFAULT_SYNCED_FOLDER_ALIASES.map(async (alias) => {
      try {
        const folder = await graphGet<GraphFolder>(ctx, `/me/mailFolders/${alias}`, {
          $select: 'id,displayName',
        });
        return { alias, folder };
      } catch (error) {
        // Nem toda caixa tem pasta "Archive"; ausencia de uma pasta opcional
        // nao e falha de sync.
        if (error instanceof ConnectorError && error.code === 'NOT_FOUND') return null;
        throw error;
      }
    }),
  );
  return resultados.filter(
    (item): item is { alias: FolderAlias; folder: GraphFolder } => item !== null,
  );
}

// ---------------------------------------------------------------------------
// Conector
// ---------------------------------------------------------------------------

export const microsoftConnector: Connector = {
  provider: 'MICROSOFT',
  capabilities: microsoftCapabilities,

  async verify(ctx) {
    const token = await ensureMicrosoftAccessToken(ctx);
    const accountEmail = await fetchMicrosoftAccountEmail(token);
    return { accountEmail };
  },

  async listMailboxes(ctx): Promise<RawMailbox[]> {
    const conhecidas = await resolveWellKnownFolders(ctx);
    const idsConhecidos = new Set(conhecidas.map((item) => item.folder.id));

    // Pastas extras criadas pelo usuario, no nivel raiz. O Graph so lista o
    // primeiro nivel por padrao; subpastas ficam para uma fase futura.
    const outras = await graphGet<{ value: GraphFolder[] }>(ctx, '/me/mailFolders', {
      $top: 250,
      $select: 'id,displayName',
    });

    const caixas: RawMailbox[] = conhecidas.map(({ alias, folder }) => ({
      providerId: folder.id,
      name: folder.displayName,
      role: folderRole(alias),
    }));

    for (const pasta of outras.value ?? []) {
      if (idsConhecidos.has(pasta.id)) continue;
      caixas.push({ providerId: pasta.id, name: pasta.displayName, role: 'CUSTOM' });
    }

    return caixas;
  },

  async listCalendars(ctx): Promise<RawCalendar[]> {
    const resposta = await graphGet<{
      value: { id: string; name?: string; color?: string; isDefaultCalendar?: boolean; canEdit?: boolean }[];
    }>(ctx, '/me/calendars', { $top: 250, $select: 'id,name,color,isDefaultCalendar,canEdit' });

    return (resposta.value ?? []).map((calendario) => ({
      providerId: calendario.id,
      name: calendario.name ?? calendario.id,
      isPrimary: calendario.isDefaultCalendar === true,
      isReadOnly: calendario.canEdit === false,
    }));
  },

  async fetchMessages(ctx, _options: FetchOptions): Promise<Page<RawMessage>> {
    // Recurso multi-container (uma pasta = um container, cada uma com seu
    // proprio deltaLink): mesmo padrao usado no calendario. Ver fetchEvents.
    const cursorAnterior = parseContainerCursor(_options.cursor);
    const pastas = await microsoftConnector.listMailboxes(ctx);
    // So sincroniza as pastas padrao (inbox/sentitems/drafts/archive) + as que
    // ja tinham cursor de uma execucao anterior (o usuario pode ter marcado
    // uma pasta extra para entrar na visao unificada).
    const alvo = pastas.filter(
      (pasta) => pasta.role !== 'TRASH' && pasta.role !== 'SPAM' && (
        pasta.role !== 'CUSTOM' || cursorAnterior[pasta.providerId]
      ),
    );

    const itens: RawMessage[] = [];
    const removidos: string[] = [];
    const tokens: Record<string, string> = {};

    for (const pasta of alvo) {
      const resultado = await fetchMessagesDaPasta(ctx, pasta.providerId, cursorAnterior[pasta.providerId]);
      itens.push(...resultado.itens);
      removidos.push(...resultado.removidos);
      if (resultado.deltaLink) tokens[pasta.providerId] = resultado.deltaLink;
    }

    return { items: itens, deletedProviderIds: removidos, cursor: serializeContainerCursor(tokens) };
  },

  async fetchEvents(ctx, options): Promise<Page<RawEvent>> {
    const cursorAnterior = parseContainerCursor(options.cursor);
    const calendarios = await microsoftConnector.listCalendars(ctx);

    const itens: RawEvent[] = [];
    const removidos: string[] = [];
    const tokens: Record<string, string> = {};

    for (const calendario of calendarios) {
      const resultado = await fetchEventsDoCalendario(
        ctx,
        calendario.providerId,
        cursorAnterior[calendario.providerId],
        options.window,
      );
      itens.push(...resultado.itens);
      removidos.push(...resultado.removidos);
      if (resultado.deltaLink) tokens[calendario.providerId] = resultado.deltaLink;
    }

    return { items: itens, deletedProviderIds: removidos, cursor: serializeContainerCursor(tokens) };
  },

  async fetchMessageBody(ctx, providerId) {
    const mensagem = await graphGet<{ body?: { contentType?: string; content?: string } }>(
      ctx,
      `/me/messages/${encodeURIComponent(providerId)}`,
      { $select: 'body' },
    );
    const conteudo = mensagem.body?.content;
    if (!conteudo) return {};
    return mensagem.body?.contentType === 'html' ? { html: conteudo } : { text: conteudo };
  },

  /**
   * Anexos do Graph vem em UMA chamada, com o conteudo ja embutido em
   * `contentBytes` (base64) — diferente do Gmail, que exige uma segunda
   * chamada por anexo.
   *
   * `$select` explicito para nao arrastar o `contentBytes` de anexo grande
   * que sera descartado logo em seguida.
   */
  async fetchAttachments(ctx, providerId, options) {
    const maxBytes = options?.maxBytes ?? MAX_ATTACHMENT_BYTES;

    const resposta = await graphGet<{
      value?: {
        id?: string;
        name?: string;
        contentType?: string;
        size?: number;
        contentBytes?: string;
        '@odata.type'?: string;
      }[];
    }>(ctx, `/me/messages/${encodeURIComponent(providerId)}/attachments`);

    const anexos: RawAttachment[] = [];
    for (const item of resposta.value ?? []) {
      // So anexo de ARQUIVO. `itemAttachment` e um e-mail/evento embutido e
      // `referenceAttachment` e um link para nuvem — nenhum dos dois tem
      // bytes para ler aqui.
      if (item['@odata.type'] && !item['@odata.type'].includes('fileAttachment')) continue;
      if (!item.contentBytes) continue;
      if ((item.size ?? 0) > maxBytes) continue;

      anexos.push({
        providerId: item.id ?? '',
        filename: item.name ?? 'anexo',
        mimeType: item.contentType ?? 'application/octet-stream',
        size: item.size ?? 0,
        data: new Uint8Array(Buffer.from(item.contentBytes, 'base64')),
      });
    }
    return anexos;
  },

  // --- Fase 4: escrita. Ver docs/08-escrita-e-acoes.md ---

  /**
   * Arquivar no Outlook e MOVER para a pasta Archive. A mensagem continua
   * existindo e volta com `unarchiveMessage`.
   */
  async archiveMessage(ctx, providerId) {
    await graphWrite(ctx, 'POST', `/me/messages/${encodeURIComponent(providerId)}/move`, {
      destinationId: 'archive',
    });
  },

  async unarchiveMessage(ctx, providerId) {
    await graphWrite(ctx, 'POST', `/me/messages/${encodeURIComponent(providerId)}/move`, {
      destinationId: 'inbox',
    });
  },

  async setMessageRead(ctx, providerId, read) {
    await graphWrite(ctx, 'PATCH', `/me/messages/${encodeURIComponent(providerId)}`, {
      isRead: read,
    });
  },

  /**
   * O Outlook nao tem "label" como o Gmail: tem `categories`, que e uma
   * lista de strings na propria mensagem. Aplicar e acrescentar a lista.
   */
  async setMessageLabel(ctx, providerId, labelId, apply) {
    const atual = await graphGet<{ categories?: string[] }>(
      ctx,
      `/me/messages/${encodeURIComponent(providerId)}`,
      { $select: 'categories' },
    );
    const existentes = atual.categories ?? [];
    const categories = apply
      ? [...new Set([...existentes, labelId])]
      : existentes.filter((c) => c !== labelId);

    await graphWrite(ctx, 'PATCH', `/me/messages/${encodeURIComponent(providerId)}`, {
      categories,
    });
  },

  async respondToEvent(ctx, ref, response) {
    const rota = { ACCEPTED: 'accept', DECLINED: 'decline', TENTATIVE: 'tentativelyAccept' };
    await graphWrite(
      ctx,
      'POST',
      `/me/events/${encodeURIComponent(ref.eventProviderId)}/${rota[response]}`,
      { sendResponse: true },
    );
  },

  async moveEvent(ctx, ref, startsAt, endsAt) {
    const caminho = `/me/events/${encodeURIComponent(ref.eventProviderId)}`;

    // Le ANTES: sem o horario anterior nao ha como desfazer.
    const atual = await graphGet<{
      start?: { dateTime?: string; timeZone?: string };
      end?: { dateTime?: string; timeZone?: string };
    }>(ctx, caminho, { $select: 'start,end' });

    await graphWrite(ctx, 'PATCH', caminho, {
      start: { dateTime: startsAt.toISOString(), timeZone: 'UTC' },
      end: { dateTime: endsAt.toISOString(), timeZone: 'UTC' },
    });

    return {
      previousStartsAt: parseGraphDate(atual.start) ?? startsAt,
      previousEndsAt: parseGraphDate(atual.end) ?? endsAt,
    };
  },

  async createEvent(ctx, event) {
    const criado = await graphWrite<{ id?: string }>(ctx, 'POST', '/me/events', {
      subject: event.title,
      body: { contentType: 'text', content: event.description ?? '' },
      start: { dateTime: event.startsAt.toISOString(), timeZone: 'UTC' },
      end: { dateTime: event.endsAt.toISOString(), timeZone: 'UTC' },
      attendees: event.attendees?.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      })),
    });
    return { providerId: criado.id ?? '' };
  },

  async sendReply(ctx, reply) {
    // `createReply` monta o rascunho ja na thread certa; depois o corpo e
    // ajustado e o rascunho e enviado. Tres chamadas, mas e o caminho que
    // preserva a conversa — `sendMail` avulso criaria uma thread nova.
    const rascunho = await graphWrite<{ id?: string }>(
      ctx,
      'POST',
      `/me/messages/${encodeURIComponent(reply.inReplyToProviderId)}/createReply`,
    );
    if (!rascunho.id) throw new ConnectorError('TRANSIENT', 'O Graph nao devolveu o rascunho');

    await graphWrite(ctx, 'PATCH', `/me/messages/${encodeURIComponent(rascunho.id)}`, {
      subject: reply.subject,
      body: { contentType: 'text', content: reply.bodyText },
      toRecipients: reply.to.map((address) => ({ emailAddress: { address } })),
    });

    await graphWrite(ctx, 'POST', `/me/messages/${encodeURIComponent(rascunho.id)}/send`);
    return { providerId: rascunho.id };
  },
};

/** Data do Graph: vem sem sufixo de fuso e precisa ser tratada como UTC. */
function parseGraphDate(valor?: { dateTime?: string; timeZone?: string }): Date | null {
  if (!valor?.dateTime) return null;
  const bruto = valor.dateTime.endsWith('Z') ? valor.dateTime : `${valor.dateTime}Z`;
  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** Teto por anexo. PDF de boleto tem dezenas de KB; o resto e desperdicio. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// E-mail: delta por pasta
// ---------------------------------------------------------------------------

async function fetchMessagesDaPasta(
  ctx: ConnectorContext,
  folderId: string,
  deltaLinkAnterior: string | undefined,
): Promise<{ itens: RawMessage[]; removidos: string[]; deltaLink?: string }> {
  const itens: RawMessage[] = [];
  const removidos: string[] = [];

  let url = deltaLinkAnterior;
  let deltaLink: string | undefined;
  let paginas = 0;

  if (!url) {
    const alvo = new URL(`${GRAPH_BASE}/me/mailFolders/${folderId}/messages/delta`);
    alvo.searchParams.set('$select', MESSAGE_SELECT);
    alvo.searchParams.set('$top', String(MAIL_PAGE_SIZE));
    url = alvo.toString();
  }

  do {
    // `url` e garantidamente definida aqui: setada antes do loop, ou pelo
    // `@odata.nextLink` da iteracao anterior, que e o que mantem o loop indo.
    const resposta: GraphDeltaPage<GraphMessageResource & { '@removed'?: unknown }> =
      await graphFetch(ctx, url!);

    for (const item of resposta.value) {
      if ('@removed' in item && item['@removed']) {
        removidos.push(item.id);
        continue;
      }
      itens.push(normalizeGraphMessage(item, folderId));
    }

    url = resposta['@odata.nextLink'];
    if (resposta['@odata.deltaLink']) deltaLink = resposta['@odata.deltaLink'];
    paginas += 1;
  } while (url && paginas < MAX_PAGES_PER_CONTAINER);

  if (url) {
    throw new ConnectorError(
      'TRANSIENT',
      `Pasta ${folderId} excedeu ${MAX_PAGES_PER_CONTAINER} paginas numa execucao`,
    );
  }

  return { itens, removidos, deltaLink };
}

// ---------------------------------------------------------------------------
// Calendario: delta por calendario (calendarView/delta)
// ---------------------------------------------------------------------------

async function fetchEventsDoCalendario(
  ctx: ConnectorContext,
  calendarId: string,
  deltaLinkAnterior: string | undefined,
  janela: FetchOptions['window'],
): Promise<{ itens: RawEvent[]; removidos: string[]; deltaLink?: string }> {
  const itens: RawEvent[] = [];
  const removidos: string[] = [];

  let url = deltaLinkAnterior;
  let deltaLink: string | undefined;
  let paginas = 0;

  if (!url) {
    const janelaEfetiva = janela ?? janelaPadrao();
    const alvo = new URL(`${GRAPH_BASE}/me/calendars/${calendarId}/calendarView/delta`);
    alvo.searchParams.set('startDateTime', janelaEfetiva.since.toISOString());
    alvo.searchParams.set('endDateTime', janelaEfetiva.until.toISOString());
    alvo.searchParams.set('$select', EVENT_SELECT);
    alvo.searchParams.set('$top', String(CALENDAR_PAGE_SIZE));
    url = alvo.toString();
  }

  do {
    let resposta: GraphDeltaPage<GraphEventResource & { '@removed'?: unknown }>;
    try {
      // O Prefer normaliza todos os dateTime da resposta para UTC, evitando
      // ter que mapear nomes de fuso horario do Windows para IANA.
      resposta = await graphFetch(ctx, url, { Prefer: 'outlook.timezone="UTC"' });
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'CURSOR_EXPIRED') throw error;
      throw error;
    }

    for (const item of resposta.value) {
      if ('@removed' in item && item['@removed']) {
        removidos.push(item.id);
        continue;
      }
      const normalizado = normalizeGraphEvent(item, calendarId);
      if (normalizado) itens.push(normalizado);
    }

    url = resposta['@odata.nextLink'];
    if (resposta['@odata.deltaLink']) deltaLink = resposta['@odata.deltaLink'];
    paginas += 1;
  } while (url && paginas < MAX_PAGES_PER_CONTAINER);

  if (url) {
    throw new ConnectorError(
      'TRANSIENT',
      `Calendario ${calendarId} excedeu ${MAX_PAGES_PER_CONTAINER} paginas numa execucao`,
    );
  }

  return { itens, removidos, deltaLink };
}

/**
 * Janela padrao do full sync. Assim como no Google, ela fica "gravada" no
 * deltaLink inicial: chamadas de incremental seguintes reusam a mesma janela
 * automaticamente, sem precisar reenviar startDateTime/endDateTime.
 */
function janelaPadrao(): { since: Date; until: Date } {
  const mesesPassado = Number(process.env.SYNC_CALENDAR_PAST_MONTHS ?? 1);
  const mesesFuturo = Number(process.env.SYNC_CALENDAR_FUTURE_MONTHS ?? 12);

  const since = new Date();
  since.setMonth(since.getMonth() - mesesPassado);
  const until = new Date();
  until.setMonth(until.getMonth() + mesesFuturo);

  return { since, until };
}
