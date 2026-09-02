import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConnector } from './registry';
import { assinaturaJanela } from './janela-calendario';
import { serializeContainerCursor } from './container-cursor';
import type { ConnectorContext } from './types';

/**
 * O sintoma em producao: as variaveis SYNC_CALENDAR_* foram corrigidas e a
 * agenda continuou igual. Motivo: o deltaLink guardado carrega a janela
 * antiga embutida, e o conector o seguia verbatim — a correcao nunca
 * chegava ao Graph. Aqui o Graph falso registra as URLs pedidas, entao da
 * para provar qual das duas o conector escolheu.
 */

const conector = getConnector('MICROSOFT');

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

const DELTA_VELHO =
  'https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=antigo';

function instalarGraphFalso(pedidas: string[]) {
  vi.stubGlobal('fetch', async (entrada: string | URL) => {
    const url = String(entrada);
    pedidas.push(url);

    if (/\/me\/calendars(\?|$)/.test(url)) {
      return Response.json({ value: [{ id: 'cal-1', name: 'Calendário', isDefaultCalendar: true }] });
    }

    if (url.includes('calendarView/delta')) {
      return Response.json({
        value: [],
        '@odata.deltaLink':
          'https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=novo',
      });
    }

    return new Response('rota inesperada', { status: 500 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cursor de calendario x janela', () => {
  it('segue o deltaLink guardado quando a janela e a mesma', async () => {
    const pedidas: string[] = [];
    instalarGraphFalso(pedidas);

    const cursor = serializeContainerCursor({ 'cal-1': DELTA_VELHO }, assinaturaJanela());
    await conector.fetchEvents(contexto(), { cursor });

    const delta = pedidas.filter((u) => u.includes('calendarView/delta'));
    expect(delta).toHaveLength(1);
    expect(delta[0]).toBe(DELTA_VELHO);
    expect(delta[0]).not.toContain('startDateTime');
  });

  it('descarta o deltaLink e refaz a janela quando a assinatura mudou', async () => {
    const pedidas: string[] = [];
    instalarGraphFalso(pedidas);

    // Assinatura de outro mes: exatamente o que um cursor velho carrega.
    const cursor = serializeContainerCursor({ 'cal-1': DELTA_VELHO }, 'p1f12@2020-01');
    await conector.fetchEvents(contexto(), { cursor });

    const delta = pedidas.filter((u) => u.includes('calendarView/delta'));
    expect(delta).toHaveLength(1);
    expect(delta[0]).not.toBe(DELTA_VELHO);
    expect(delta[0]).toContain('startDateTime');
    expect(delta[0]).toContain('endDateTime');
  });

  it('cursor de producao anterior a este campo tambem refaz a janela', async () => {
    const pedidas: string[] = [];
    instalarGraphFalso(pedidas);

    // Formato antigo: so containers, sem assinatura nenhuma.
    await conector.fetchEvents(contexto(), {
      cursor: JSON.stringify({ 'cal-1': DELTA_VELHO }),
    });

    const delta = pedidas.filter((u) => u.includes('calendarView/delta'));
    expect(delta[0]).toContain('startDateTime');
  });

  it('o cursor devolvido carrega a janela em vigor', async () => {
    instalarGraphFalso([]);

    const page = await conector.fetchEvents(contexto(), {});
    expect(page.cursor).toBeDefined();
    expect(JSON.parse(page.cursor as string)).toMatchObject({
      'cal-1': expect.stringContaining('deltatoken=novo'),
      __janela: assinaturaJanela(),
    });
  });
});
