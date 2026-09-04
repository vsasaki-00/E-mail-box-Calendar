/**
 * Arnes de gravacao — roda contra um Postgres DE VERDADE.
 *
 *     npx tsx scripts/verificar-persist.ts
 *
 * NAO faz parte do `pnpm test`: a CI nao sobe banco, e os testes de nucleo
 * rodam em segundos justamente por nao tocarem nele. Este script existe para
 * quando `persist.ts` for mexido — foi o que provou que a gravacao em lote
 * preserva o comportamento da versao item a item.
 *
 * Exercita o que a gravacao promete: deduplicacao entre contas, remocao que
 * nao mata o item enquanto sobrar copia, evento de container desconhecido, e
 * a copia que TROCA de item unificado quando o assunto muda.
 *
 * APAGA as conexoes e os itens unificados do primeiro usuario do banco. Aponte
 * a DATABASE_URL para um banco descartavel.
 */
import { PrismaClient } from '@prisma/client';

const cliente = new PrismaClient();
(globalThis as unknown as { prisma?: PrismaClient }).prisma = cliente;

let falhas = 0;
function conferir(rotulo: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? '  ok' : 'FALHA'}  ${rotulo}: ${JSON.stringify(real)}` +
    (ok ? '' : ` (esperado ${JSON.stringify(esperado)})`));
}

function msg(over: Record<string, unknown> = {}) {
  return {
    providerId: 'p1',
    providerThreadId: 't1',
    rfcMessageId: '<mesma@exemplo.com>',
    mailboxProviderId: 'INBOX',
    subject: 'assunto',
    snippet: 'trecho',
    fromName: 'Alguem',
    fromEmail: 'alguem@exemplo.com',
    toEmails: ['eu@exemplo.com'],
    ccEmails: [],
    receivedAt: new Date('2026-09-01T12:00:00Z'),
    isRead: false,
    isFlagged: false,
    hasAttachments: false,
    labels: [],
    ...over,
  };
}

async function main() {
  const { persistMessages, persistEvents } = await import('../src/core/sync/persist');

  const user =
    (await cliente.user.findFirst({ orderBy: { createdAt: 'asc' } })) ??
    (await cliente.user.create({ data: { email: 'verif@teste.local' } }));
  // Limpa tambem os itens unificados: eles pertencem ao usuario, nao a
  // conexao, entao apagar conexoes deixa orfaos de execucoes anteriores.
  await cliente.connection.deleteMany({ where: { userId: user.id } });
  await cliente.unifiedItem.deleteMany({ where: { userId: user.id } });

  const conta = async (email: string) => {
    const c = await cliente.connection.create({
      data: {
        userId: user.id,
        provider: 'GOOGLE',
        accountEmail: email,
        capabilities: { mail: true, calendar: true, pollIntervalSeconds: 300 },
      },
    });
    const caixa = await cliente.mailbox.create({
      data: { connectionId: c.id, providerId: 'INBOX', name: 'Entrada', role: 'INBOX' },
    });
    const cal = await cliente.calendarSource.create({
      data: { connectionId: c.id, providerId: 'primary', name: 'Agenda' },
    });
    return { c, caixas: new Map([['INBOX', caixa.id]]), cals: new Map([['primary', cal.id]]) };
  };

  const a = await conta('a@teste.local');
  const b = await conta('b@teste.local');

  // --- a MESMA mensagem chega nas duas contas ---
  await persistMessages({ connectionId: a.c.id, userId: user.id, mensagens: [msg()] as never, mailboxIdPorProviderId: a.caixas });
  await persistMessages({ connectionId: b.c.id, userId: user.id, mensagens: [msg()] as never, mailboxIdPorProviderId: b.caixas });

  const itens = await cliente.unifiedItem.findMany({ where: { userId: user.id } });
  conferir('um item unificado para as duas copias', itens.length, 1);
  conferir('copyCount = 2', itens[0]?.copyCount, 2);

  // --- reprocessar a MESMA pagina nao infla nada ---
  await persistMessages({ connectionId: a.c.id, userId: user.id, mensagens: [msg()] as never, mailboxIdPorProviderId: a.caixas });
  const depois = await cliente.unifiedItem.findMany({ where: { userId: user.id } });
  conferir('reprocessar nao muda copyCount', depois[0]?.copyCount, 2);
  conferir('reprocessar nao duplica mensagem', await cliente.message.count(), 2);

  // --- remover de UMA conta nao mata o item ---
  const r1 = await persistMessages({ connectionId: a.c.id, userId: user.id, mensagens: [], removidos: ['p1'], mailboxIdPorProviderId: a.caixas });
  conferir('removeu 1', r1.deleted, 1);
  const sobrou = await cliente.unifiedItem.findMany({ where: { userId: user.id } });
  conferir('item sobrevive com 1 copia', sobrou[0]?.copyCount, 1);

  // --- remover a ULTIMA copia mata o item ---
  await persistMessages({ connectionId: b.c.id, userId: user.id, mensagens: [], removidos: ['p1'], mailboxIdPorProviderId: b.caixas });
  conferir('item morre sem copia', await cliente.unifiedItem.count({ where: { userId: user.id } }), 0);

  // --- a copia TROCA de item quando o assunto muda ---
  await persistMessages({ connectionId: a.c.id, userId: user.id, mensagens: [msg({ rfcMessageId: null })] as never, mailboxIdPorProviderId: a.caixas });
  const antes = await cliente.unifiedItem.findMany({ where: { userId: user.id }, select: { id: true } });
  await persistMessages({ connectionId: a.c.id, userId: user.id, mensagens: [msg({ rfcMessageId: null, subject: 'OUTRO assunto' })] as never, mailboxIdPorProviderId: a.caixas });
  const agora = await cliente.unifiedItem.findMany({ where: { userId: user.id }, select: { id: true, copyCount: true } });
  conferir('o item antigo foi recolhido', agora.length, 1);
  conferir('e e outro item', agora[0]?.id !== antes[0]?.id, true);
  conferir('com uma copia', agora[0]?.copyCount, 1);

  // --- evento de calendario desconhecido e CONTADO, nao gravado ---
  const evento = {
    providerId: 'e1', calendarProviderId: 'nao-existe', iCalUid: 'u1', recurringEventId: null,
    title: 'reuniao', description: null, location: null,
    startsAt: new Date('2026-09-10T12:00:00Z'), endsAt: new Date('2026-09-10T13:00:00Z'),
    isAllDay: false, timezone: 'UTC', status: 'CONFIRMED', responseStatus: 'NEEDS_ACTION',
    organizerEmail: null, attendees: [], conferenceUrl: null,
  };
  const re = await persistEvents({ connectionId: a.c.id, userId: user.id, eventos: [evento] as never, calendarIdPorProviderId: a.cals });
  conferir('descarte contado', re.skippedUnknownContainer, 1);
  conferir('nada gravado', await cliente.calendarEvent.count(), 0);

  // --- evento valido grava e reprocessa limpo ---
  const bom = { ...evento, calendarProviderId: 'primary' };
  const r2 = await persistEvents({ connectionId: a.c.id, userId: user.id, eventos: [bom] as never, calendarIdPorProviderId: a.cals });
  conferir('evento criado', r2.created, 1);
  const r3 = await persistEvents({ connectionId: a.c.id, userId: user.id, eventos: [bom] as never, calendarIdPorProviderId: a.cals });
  conferir('reprocessar nao reescreve', [r3.created, r3.updated], [0, 0]);

  await cliente.connection.deleteMany({ where: { userId: user.id } });
  await cliente.$disconnect();
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main();
