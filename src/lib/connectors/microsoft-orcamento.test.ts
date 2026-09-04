import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConnector } from './registry';
import type { ConnectorContext } from './types';

/**
 * "Adiado nao e pendente", no conector do Graph.
 *
 * Com o orcamento de tempo esgotado, o conector adia os containers que nao
 * couberam. Antes, adiar marcava a execucao inteira como INCOMPLETA — e
 * incompleta faz o motor voltar imediatamente. Com mais pastas do que cabe
 * num orcamento, isso e um laco que nunca pode terminar: toda volta adia
 * alguma coisa, toda volta pede outra volta.
 *
 * A correcao distingue o que esta guardado no cursor de cada container: um
 * ponto final (`d:`) ou uma paginacao em andamento (`p:`). So a segunda e
 * trabalho pendente.
 */

const conector = getConnector('MICROSOFT');
const PASTAS = ['inbox', 'sentitems', 'drafts', 'archive'];
const CALENDARIOS = ['agenda-a', 'agenda-b', 'agenda-c', 'agenda-d'];

function contexto(): ConnectorContext {
  return {
    connectionId: 'c1',
    accountEmail: 'teste@outlook.com',
    config: {},
    credentials: { accessToken: 'token', expiresAt: new Date(Date.now() + 3_600_000) },
    capabilities: conector.capabilities,
    saveCredentials: async () => {},
  } as unknown as ConnectorContext;
}

let buscas: string[] = [];

/**
 * Graph falso. `paginasPorPasta = 1` faz cada pasta terminar de primeira
 * (deltaLink); acima disso ela para no meio (nextLink).
 */
function instalarGraphFalso(paginasPorPasta = 1) {
  buscas = [];
  vi.stubGlobal('fetch', async (entrada: string | URL) => {
    const url = String(entrada);

    if (/\/me\/mailFolders(\?|$)/.test(url)) {
      return Response.json({
        value: PASTAS.map((id) => ({ id, displayName: id })),
      });
    }

    if (url.includes('/mailFolders/') && !url.includes('/messages/delta')) {
      const alias = url.split('/mailFolders/')[1]?.split('?')[0] ?? '';
      if (!PASTAS.includes(alias)) return new Response('nao encontrado', { status: 404 });
      return Response.json({ id: alias, displayName: alias });
    }

    if (url.includes('/me/calendars') && !url.includes('/calendarView')) {
      return Response.json({
        value: CALENDARIOS.map((id) => ({ id, name: id, canEdit: true })),
      });
    }

    if (url.includes('/calendarView/delta')) {
      const calendario = url.split('/me/calendars/')[1]?.split('/')[0] ?? '?';
      const pagina = Number(new URL(url).searchParams.get('p') ?? '0');
      buscas.push(calendario);
      const value = [
        {
          id: `${calendario}-e${pagina}`,
          subject: 'reunião',
          start: { dateTime: '2026-09-10T12:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-09-10T13:00:00.0000000', timeZone: 'UTC' },
        },
      ];
      const base = `https://graph.microsoft.com/v1.0/me/calendars/${calendario}/calendarView/delta`;
      const proxima = pagina + 1;
      return Response.json(
        proxima < paginasPorPasta
          ? { value, '@odata.nextLink': `${base}?p=${proxima}&$skiptoken=x` }
          : { value, '@odata.deltaLink': `${base}?$deltatoken=final` },
      );
    }

    if (url.includes('/messages/delta')) {
      const pasta = url.split('/mailFolders/')[1]?.split('/')[0] ?? '?';
      const pagina = Number(new URL(url).searchParams.get('p') ?? '0');
      buscas.push(pasta);
      const value = [
        {
          id: `${pasta}-m${pagina}`,
          subject: 'assunto',
          receivedDateTime: '2026-09-01T12:00:00Z',
          from: { emailAddress: { address: 'alguem@exemplo.com' } },
        },
      ];
      const proxima = pagina + 1;
      const base = `https://graph.microsoft.com/v1.0/me/mailFolders/${pasta}/messages/delta`;
      return Response.json(
        proxima < paginasPorPasta
          ? { value, '@odata.nextLink': `${base}?p=${proxima}&$skiptoken=x` }
          : { value, '@odata.deltaLink': `${base}?$deltatoken=final` },
      );
    }

    return new Response('rota inesperada', { status: 500 });
  });
}

/** Roda voltas como o motor faz, ate sair um cursor. Devolve quantas foram. */
async function ateTerminar(
  recurso: 'mail' | 'calendar',
  cursorInicial?: string,
): Promise<{ voltas: number; cursor?: string }> {
  let pageToken: string | undefined;
  const cursor = cursorInicial;
  let voltas = 0;

  while (voltas < 30) {
    voltas += 1;
    const page =
      recurso === 'mail'
        ? await conector.fetchMessages(contexto(), { cursor, pageToken })
        : await conector.fetchEvents(contexto(), { cursor, pageToken });
    if (!page.nextPageToken) return { voltas, cursor: page.cursor };
    pageToken = page.nextPageToken;
  }
  throw new Error('nao terminou em 30 voltas — laco infinito');
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GRAPH_RUN_BUDGET_MS;
  delete process.env.GRAPH_PAGES_PER_RUN;
});

describe('orcamento esgotado no Graph', () => {
  it('com orcamento zerado, a carga inicial TERMINA — um container por volta', async () => {
    // Era exatamente aqui que o laco nao fechava: toda volta adiava algum
    // container, e adiar marcava incompleto.
    process.env.GRAPH_RUN_BUDGET_MS = '0';
    instalarGraphFalso();

    const { voltas, cursor } = await ateTerminar('calendar');
    expect(voltas).toBe(CALENDARIOS.length);
    expect(cursor).toBeTruthy();
    expect(new Set(buscas)).toEqual(new Set(CALENDARIOS));
  });

  it('ja sincronizado, uma volta fecha mesmo sem orcamento', async () => {
    // O regime permanente: todos os containers tem ponto final. Adiar os que
    // nao couberam nao e trabalho pendente — e o que faz a volta terminar.
    process.env.GRAPH_RUN_BUDGET_MS = '0';
    instalarGraphFalso();
    const { cursor } = await ateTerminar('calendar');

    buscas = [];
    const segunda = await ateTerminar('calendar', cursor);
    expect(segunda.voltas).toBe(1);
    expect(buscas).toHaveLength(1); // so o primeiro; o resto ficou para depois
  });

  it('o mesmo vale para as pastas de e-mail', async () => {
    process.env.GRAPH_RUN_BUDGET_MS = '0';
    instalarGraphFalso();

    const { voltas, cursor } = await ateTerminar('mail');
    expect(voltas).toBe(PASTAS.length);
    expect(cursor).toBeTruthy();

    buscas = [];
    expect((await ateTerminar('mail', cursor)).voltas).toBe(1);
  });

  it('parada NO MEIO de uma paginacao continua sendo pendente', async () => {
    // A distincao inteira existe para nao confundir os dois casos: adiar um
    // ponto final e barato, abandonar uma paginacao nao pode ser esquecido.
    process.env.GRAPH_PAGES_PER_RUN = '1';
    instalarGraphFalso(3);

    const page = await conector.fetchMessages(contexto(), {});
    expect(page.nextPageToken).toBeTruthy();
    expect(page.cursor).toBeUndefined();
    // A marca `p:` viaja no cursor do container.
    expect(page.nextPageToken).toContain('p:');
  });

  it('cursor no formato antigo (URL crua) ainda e aceito', async () => {
    // Cursores gravados antes da marca existir valem como ponto final.
    process.env.GRAPH_RUN_BUDGET_MS = '0';
    instalarGraphFalso();

    const antigo = JSON.stringify(
      Object.fromEntries(
        PASTAS.map((p) => [
          p,
          `https://graph.microsoft.com/v1.0/me/mailFolders/${p}/messages/delta?$deltatoken=antigo`,
        ]),
      ),
    );

    const { voltas, cursor } = await ateTerminar('mail', antigo);
    expect(voltas).toBe(1);
    expect(cursor).toBeTruthy();
  });
});
