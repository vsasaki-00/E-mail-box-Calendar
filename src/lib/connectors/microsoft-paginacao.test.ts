import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConnector } from './registry';
import type { ConnectorContext } from './types';

/**
 * Retomada da paginacao do Graph.
 *
 * O conector paginava ate 60 paginas numa unica execucao e, ao estourar,
 * LANCAVA — descartando tudo que ja tinha buscado. Numa funcao serverless de
 * 60s isso virava timeout, e a plataforma respondia com uma pagina de texto
 * no lugar do JSON. Foi o que travou as duas primeiras caixas Outlook reais.
 *
 * Aqui um Graph falso serve 20 paginas para provar o que importa: cada
 * execucao devolve o controle cedo, e o conjunto das execucoes entrega
 * exatamente uma copia de cada mensagem.
 */

const conector = getConnector('MICROSOFT');
const TOTAL_PAGINAS = 20;
const POR_PAGINA = 3;

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

/** Graph falso: uma pasta so, paginada, com deltaLink na ultima pagina. */
function instalarGraphFalso() {
  vi.stubGlobal('fetch', async (entrada: string | URL) => {
    const url = String(entrada);

    // Listagem das pastas de nivel raiz (sem alias no caminho).
    if (/\/me\/mailFolders(\?|$)/.test(url)) {
      return Response.json({ value: [{ id: 'inbox', displayName: 'Caixa de Entrada' }] });
    }

    if (url.includes('/mailFolders/') && !url.includes('/messages/delta')) {
      const alias = url.split('/mailFolders/')[1]?.split('?')[0] ?? 'inbox';
      // Só a inbox existe; o resto some, como numa caixa sem Arquivo.
      if (alias !== 'inbox') return new Response('nao encontrado', { status: 404 });
      return Response.json({ id: 'inbox', displayName: 'Caixa de Entrada' });
    }

    if (url.includes('/messages/delta')) {
      const pagina = Number(new URL(url).searchParams.get('p') ?? '0');
      const value = Array.from({ length: POR_PAGINA }, (_, i) => ({
        id: `m${pagina * POR_PAGINA + i}`,
        subject: 'assunto',
        receivedDateTime: '2026-08-31T12:00:00Z',
        from: { emailAddress: { address: 'alguem@exemplo.com' } },
      }));
      const proxima = pagina + 1;
      return Response.json(
        proxima < TOTAL_PAGINAS
          ? { value, '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?p=${proxima}` }
          : { value, '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?p=final' },
      );
    }

    return new Response('rota inesperada', { status: 500 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GRAPH_RUN_BUDGET_MS;
});

describe('paginacao do Graph em execucoes curtas', () => {
  it('devolve o controle antes de esgotar as paginas, sem perder nem repetir', async () => {
    instalarGraphFalso();
    const ctx = contexto();

    const vistos: string[] = [];
    let pageToken: string | undefined;
    let cursorFinal: string | undefined;
    let execucoes = 0;

    // Repete como o motor faz: enquanto vier nextPageToken, continua.
    while (execucoes < 30) {
      execucoes += 1;
      const page = await conector.fetchMessages(ctx, { pageToken });
      vistos.push(...page.items.map((m) => m.providerId));

      if (!page.nextPageToken) {
        cursorFinal = page.cursor;
        break;
      }
      pageToken = page.nextPageToken;
    }

    // Precisou de mais de uma execucao — e o ponto: antes era tudo de uma vez.
    expect(execucoes).toBeGreaterThan(1);
    // Terminou, e so entao existe cursor para gravar.
    expect(cursorFinal).toBeTruthy();

    // Nada perdido, nada duplicado.
    expect(vistos).toHaveLength(TOTAL_PAGINAS * POR_PAGINA);
    expect(new Set(vistos).size).toBe(vistos.length);
  });

  it('nao entrega cursor enquanto sobrar pagina', async () => {
    // Gravar cursor no meio faria a proxima execucao pular o que faltava.
    instalarGraphFalso();
    const page = await conector.fetchMessages(contexto(), {});
    expect(page.nextPageToken).toBeTruthy();
    expect(page.cursor).toBeUndefined();
  });
});

describe('orcamento de tempo', () => {
  it('avanca pelo menos uma pagina mesmo com orcamento zerado', async () => {
    // Sem esta garantia, um ambiente lento faria o cliente repetir para
    // sempre sem sincronizar nada — laco infinito com cara de progresso.
    process.env.GRAPH_RUN_BUDGET_MS = '0';
    instalarGraphFalso();

    const page = await conector.fetchMessages(contexto(), {});
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.nextPageToken).toBeTruthy();
  });

  it('com orcamento zerado ainda termina a caixa inteira, em mais voltas', async () => {
    process.env.GRAPH_RUN_BUDGET_MS = '0';
    instalarGraphFalso();

    const vistos: string[] = [];
    let pageToken: string | undefined;
    let voltas = 0;

    while (voltas < 60) {
      voltas += 1;
      const page = await conector.fetchMessages(contexto(), { pageToken });
      vistos.push(...page.items.map((m) => m.providerId));
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }

    expect(vistos).toHaveLength(TOTAL_PAGINAS * POR_PAGINA);
    expect(new Set(vistos).size).toBe(vistos.length);
  });
});

describe('calendarView/delta — restricoes do Graph', () => {
  it('NAO manda $top e pede tamanho de pagina pelo header Prefer', async () => {
    // O Graph recusa a chamada inteira com ErrorInvalidUrlQuery quando
    // `$top` aparece no calendarView/delta. Foi o erro real que impediu as
    // duas primeiras caixas Outlook deste projeto de sincronizar.
    const chamadas: { url: string; prefer?: string }[] = [];

    vi.stubGlobal('fetch', async (entrada: string | URL, init?: RequestInit) => {
      const url = String(entrada);
      const prefer = new Headers(init?.headers).get('prefer') ?? undefined;
      chamadas.push({ url, prefer });

      if (url.includes('/me/calendars') && !url.includes('calendarView')) {
        return Response.json({ value: [{ id: 'cal1', name: 'Agenda', isDefaultCalendar: true }] });
      }
      if (url.includes('calendarView/delta')) {
        return Response.json({ value: [], '@odata.deltaLink': 'https://graph/delta?final' });
      }
      return new Response('rota inesperada', { status: 500 });
    });

    await conector.fetchEvents(contexto(), {});

    const delta = chamadas.find((c) => c.url.includes('calendarView/delta'));
    expect(delta).toBeDefined();
    expect(delta!.url).not.toContain('$top');
    expect(delta!.prefer).toContain('odata.maxpagesize=');
    // E o fuso continua normalizado para UTC no mesmo header.
    expect(delta!.prefer).toContain('outlook.timezone="UTC"');
  });
});
