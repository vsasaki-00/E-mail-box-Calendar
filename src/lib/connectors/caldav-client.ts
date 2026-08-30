import { createDAVClient } from 'tsdav';
import type { RawCalendar } from './types';
import { ConnectorError } from './types';
import { mapCaldavError } from './imap-caldav-errors';
import { expandIcsToRawEvents, type IcsExpansionWindow } from './ical-normalize';

/**
 * `createDAVClient` devolve um objeto com metodos ja vinculados a conta —
 * estruturalmente parecido mas nao identico a classe `DAVClient` exportada
 * pela biblioteca (verificado em node_modules/tsdav/dist/tsdav.cjs.js). O
 * tipo correto e o retorno real da factory, nao a classe.
 */
type CaldavClient = Awaited<ReturnType<typeof createDAVClient>>;

/**
 * Fina camada sobre o tsdav: descoberta de conta, listagem de calendarios e
 * sync de eventos. Ver docs/03-conectores.md
 *
 * Sync incremental usa `syncCollection` (REPORT sync-collection, RFC 6578) —
 * chamado diretamente em vez de `client.smartCollectionSyncDetailed`, cujo
 * caminho "basic" (ctag) exige anexar funcoes como propriedade no objeto
 * calendario (`collection.fetchObjects`), um modelo com estado que nao
 * combina com este conector: aqui tudo e reconstruido do cursor persistido a
 * cada execucao, sem objetos vivos entre chamadas. Ver imapflow/tsdav lidos
 * em node_modules nesta sessao (sem docs online alcancaveis daqui).
 */

export interface CaldavConnectionConfig {
  serverUrl: string;
  username: string;
  password: string;
}

async function createClient(config: CaldavConnectionConfig): Promise<CaldavClient> {
  try {
    return await createDAVClient({
      serverUrl: config.serverUrl,
      credentials: { username: config.username, password: config.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
  } catch (error) {
    throw mapCaldavError(error);
  }
}

export async function verifyCaldavConnection(config: CaldavConnectionConfig): Promise<void> {
  await createClient(config);
}

export async function listCaldavCalendars(config: CaldavConnectionConfig): Promise<RawCalendar[]> {
  try {
    const client = await createClient(config);
    const calendarios = await client.fetchCalendars();

    return calendarios.map((calendario) => ({
      providerId: calendario.url,
      name:
        typeof calendario.displayName === 'string'
          ? calendario.displayName
          : (calendario.url.split('/').filter(Boolean).pop() ?? calendario.url),
      timezone: calendario.timezone || undefined,
      color: calendario.calendarColor,
      isPrimary: false,
      // supported-report-set nao inclui write; a fase 1 e read-only mesmo
      // quando o calendario aceita escrita, entao nao testamos aqui.
      isReadOnly: true,
    }));
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw mapCaldavError(error);
  }
}

export interface CaldavFetchResult {
  items: ReturnType<typeof expandIcsToRawEvents>;
  deletedProviderIds: string[];
  syncToken?: string;
}

const CALDAV_OBJECT_PROPS = { 'd:getetag': {}, 'c:calendar-data': {} };

/**
 * Extrai o novo syncToken da resposta multistatus do REPORT sync-collection.
 * O tsdav guarda a arvore XML crua em `response.raw`; a mesma leitura que o
 * `smartCollectionSync` interno do tsdav faz (ver node_modules/tsdav).
 */
function extrairSyncToken(respostas: { raw?: unknown }[]): string | undefined {
  const raw = respostas[0]?.raw as
    | { multistatus?: { syncToken?: string | { _text?: string } } }
    | undefined;
  const token = raw?.multistatus?.syncToken;
  if (typeof token === 'string') return token;
  if (token && typeof token === 'object' && typeof token._text === 'string') return token._text;
  return undefined;
}

function extrairIcs(props: Record<string, unknown> | undefined): string | undefined {
  const dado = props?.calendarData as { _cdata?: string } | string | undefined;
  if (typeof dado === 'string') return dado;
  return dado?._cdata;
}

async function fetchEventosCompletos(
  client: CaldavClient,
  calendarUrl: string,
  window: IcsExpansionWindow,
  accountEmail: string,
): Promise<ReturnType<typeof expandIcsToRawEvents>> {
  let objetos;
  try {
    // Pede expansao no servidor quando ele suporta (iCloud suporta); o
    // fallback local em ical-normalize.ts cobre quem nao suporta.
    objetos = await client.fetchCalendarObjects({
      calendar: { url: calendarUrl },
      timeRange: { start: window.since.toISOString(), end: window.until.toISOString() },
      expand: true,
    });
  } catch {
    // Servidor recusou o filtro expand (nem todo servidor CalDAV aceita);
    // repete sem ele e expande localmente.
    objetos = await client.fetchCalendarObjects({
      calendar: { url: calendarUrl },
      timeRange: { start: window.since.toISOString(), end: window.until.toISOString() },
    });
  }

  const eventos: ReturnType<typeof expandIcsToRawEvents> = [];
  for (const objeto of objetos) {
    if (!objeto.data) continue;
    eventos.push(...expandIcsToRawEvents(objeto.data, calendarUrl, window, accountEmail));
  }
  return eventos;
}

export async function fetchCaldavEvents(
  config: CaldavConnectionConfig,
  calendarUrl: string,
  previousSyncToken: string | undefined,
  window: IcsExpansionWindow,
  accountEmail: string,
): Promise<CaldavFetchResult> {
  const client = await createClient(config);

  if (!previousSyncToken) {
    const items = await fetchEventosCompletos(client, calendarUrl, window, accountEmail);

    // Captura o syncToken atual do calendario para servir de ponto de
    // partida do proximo incremental — mesmo principio do historyId do
    // Gmail: pegar o cursor ANTES de terminar de listar.
    const [calendario] = await client.fetchCalendars({ props: { 'd:sync-token': {} } }).catch(() => []);
    const syncToken = calendario?.url === calendarUrl ? calendario.syncToken : undefined;

    return { items, deletedProviderIds: [], syncToken };
  }

  try {
    const resultado = await client.syncCollection({
      url: calendarUrl,
      props: { 'd:getetag': {}, 'c:calendar-data': {}, 'd:displayname': {} },
      syncLevel: 1,
      syncToken: previousSyncToken,
    });

    const respostasDeObjeto = resultado.filter((r) => r.href?.endsWith('.ics'));
    const alteradas = respostasDeObjeto.filter((r) => r.status !== 404);
    const removidas = respostasDeObjeto.filter((r) => r.status === 404);

    const itemsCompletos: ReturnType<typeof expandIcsToRawEvents> = [];
    if (alteradas.length > 0) {
      const urls = alteradas.map((r) => r.href).filter((href): href is string => Boolean(href));
      const objetos = await client.calendarMultiGet({
        url: calendarUrl,
        props: CALDAV_OBJECT_PROPS,
        objectUrls: urls,
        depth: '1',
      });

      for (const objeto of objetos) {
        const ics = extrairIcs(objeto.props);
        if (!ics) continue;
        itemsCompletos.push(...expandIcsToRawEvents(ics, calendarUrl, window, accountEmail));
      }
    }

    return {
      items: itemsCompletos,
      deletedProviderIds: removidas.map((r) => r.href).filter((href): href is string => Boolean(href)),
      syncToken: extrairSyncToken(resultado) ?? previousSyncToken,
    };
  } catch (error) {
    // RFC 6578: 410 Gone (ou 403 em alguns servidores) quando o token
    // invalidou. mapCaldavError ja traduz para CURSOR_EXPIRED.
    throw mapCaldavError(error);
  }
}
