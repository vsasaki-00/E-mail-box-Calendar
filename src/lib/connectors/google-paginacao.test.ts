import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConnector } from './registry';
import type { ConnectorContext } from './types';

/**
 * Orcamento de tempo no calendario do Google.
 *
 * O conector percorria TODOS os calendarios e TODAS as paginas de cada um
 * numa unica chamada — ate 60 paginas por calendario, sem nenhum limite que a
 * funcao serverless respeitasse. Era o unico caminho do app capaz de rodar
 * indefinidamente. Em producao apareceu primeiro como
 * FUNCTION_INVOCATION_TIMEOUT e depois, pior, como pool esgotado: a execucao
 * abandonada pelo prazo continua gravando enquanto a proxima ja comecou.
 *
 * O conector Microsoft ja resolvia assim; este ficou para tras. Um Google
 * falso com quatro calendarios prova o que importa: cada volta devolve o
 * controle cedo, a volta seguinte RETOMA (nao recomeca), e o conjunto entrega
 * cada evento uma vez so.
 */

const conector = getConnector('GOOGLE');
const CALENDARIOS = ['agenda-a', 'agenda-b', 'agenda-c', 'agenda-d'];

function contexto(): ConnectorContext {
  return {
    connectionId: 'c1',
    accountEmail: 'teste@gmail.com',
    config: {},
    credentials: { accessToken: 'token', expiresAt: new Date(Date.now() + 3_600_000) },
    capabilities: conector.capabilities,
    saveCredentials: async () => {},
  } as unknown as ConnectorContext;
}

/** Conta quantas vezes cada calendario foi realmente buscado. */
let buscas: string[] = [];

function instalarGoogleFalso() {
  buscas = [];
  vi.stubGlobal('fetch', async (entrada: string | URL) => {
    const url = new URL(String(entrada));

    if (url.pathname.endsWith('/users/me/calendarList')) {
      return Response.json({
        items: CALENDARIOS.map((id) => ({ id, summary: id, accessRole: 'owner' })),
      });
    }

    const evento = /\/calendars\/([^/]+)\/events/.exec(url.pathname);
    if (evento) {
      const calendario = decodeURIComponent(evento[1] ?? '');
      buscas.push(calendario);
      return Response.json({
        items: [
          {
            id: `${calendario}-e1`,
            status: 'confirmed',
            summary: 'reunião',
            start: { dateTime: '2026-09-10T12:00:00Z' },
            end: { dateTime: '2026-09-10T13:00:00Z' },
          },
        ],
        nextSyncToken: `sync-${calendario}`,
      });
    }

    return new Response('rota inesperada', { status: 500 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_RUN_BUDGET_MS;
});

describe('orcamento de tempo no calendario do Google', () => {
  it('com orcamento zerado, avanca UM calendario por volta — nunca zero', async () => {
    // Zero calendarios por volta seria um laco infinito com cara de
    // progresso; todos de uma vez e o que estourava a funcao.
    process.env.GOOGLE_RUN_BUDGET_MS = '0';
    instalarGoogleFalso();

    const page = await conector.fetchEvents(contexto(), {});
    expect(buscas).toEqual(['agenda-a']);
    expect(page.items).toHaveLength(1);
    // Sobrou trabalho: viaja em nextPageToken, e NAO em cursor.
    expect(page.nextPageToken).toBeTruthy();
    expect(page.cursor).toBeUndefined();
  });

  it('a volta seguinte RETOMA: nao busca de novo o que ja terminou', async () => {
    // Sem preservar o token dos calendarios ja prontos, cada volta refaria
    // tudo do zero e o sync nunca terminaria.
    process.env.GOOGLE_RUN_BUDGET_MS = '0';
    instalarGoogleFalso();

    const primeira = await conector.fetchEvents(contexto(), {});
    buscas = [];
    await conector.fetchEvents(contexto(), { pageToken: primeira.nextPageToken });

    expect(buscas).toEqual(['agenda-b']);
  });

  it('em varias voltas entrega todos os calendarios, uma vez cada', async () => {
    process.env.GOOGLE_RUN_BUDGET_MS = '0';
    instalarGoogleFalso();

    const vistos: string[] = [];
    let pageToken: string | undefined;
    let cursorFinal: string | undefined;
    let voltas = 0;

    while (voltas < 20) {
      voltas += 1;
      const page = await conector.fetchEvents(contexto(), { pageToken });
      vistos.push(...page.items.map((e) => e.providerId));
      if (!page.nextPageToken) {
        cursorFinal = page.cursor;
        break;
      }
      pageToken = page.nextPageToken;
    }

    // Uma volta por calendario a sincronizar, mais a ultima que fecha.
    expect(voltas).toBeGreaterThan(1);
    expect(voltas).toBeLessThanOrEqual(CALENDARIOS.length + 1);
    // Só existe cursor para gravar quando não sobrou full sync nenhum.
    expect(cursorFinal).toBeTruthy();
    // Todo calendario foi visitado, e nenhum evento veio duplicado.
    expect(new Set(buscas)).toEqual(new Set(CALENDARIOS));
    expect(new Set(vistos).size).toBe(vistos.length);
  });

  it('com orcamento folgado, uma volta so resolve tudo', async () => {
    // A mudanca nao pode transformar o caso normal em quatro requisicoes.
    instalarGoogleFalso();

    const page = await conector.fetchEvents(contexto(), {});
    expect(buscas).toEqual(CALENDARIOS);
    expect(page.nextPageToken).toBeUndefined();
    expect(page.cursor).toBeTruthy();
  });
});
