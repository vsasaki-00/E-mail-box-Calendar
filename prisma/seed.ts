import { PrismaClient, Prisma, type Provider } from '@prisma/client';
import { messageDedupeKey, eventDedupeKey } from '../src/core/unified/dedupe';

/**
 * Dados de demonstracao. Nenhuma credencial real, nenhuma chamada a provedor.
 *
 * O cenario e montado de proposito para exercitar as duas coisas que so este
 * app enxerga: o mesmo convite chegando em duas contas (deduplicacao) e uma
 * reuniao do Google sobrepondo uma do Microsoft (conflito entre contas).
 */

const prisma = new PrismaClient();

const CAPACIDADES: Record<Provider, Prisma.InputJsonValue> = {
  GOOGLE: {
    mail: true,
    calendar: true,
    contacts: true,
    incrementalSync: 'history-api',
    push: true,
    serverSideSearch: true,
    write: false,
    pollIntervalSeconds: 300,
  },
  MICROSOFT: {
    mail: true,
    calendar: true,
    contacts: true,
    incrementalSync: 'delta-token',
    push: true,
    serverSideSearch: true,
    write: false,
    pollIntervalSeconds: 300,
  },
  APPLE: {
    mail: true,
    calendar: true,
    contacts: false,
    incrementalSync: 'etag-poll',
    push: false,
    serverSideSearch: false,
    write: false,
    pollIntervalSeconds: 900,
  },
  IMAP_CALDAV: {
    mail: true,
    calendar: true,
    contacts: false,
    incrementalSync: 'etag-poll',
    push: false,
    serverSideSearch: false,
    write: false,
    pollIntervalSeconds: 900,
  },
};

/** Horario de hoje, para os eventos caírem sempre no dia atual. */
function hojeAs(hora: number, minuto = 0): Date {
  const data = new Date();
  data.setHours(hora, minuto, 0, 0);
  return data;
}

function minutosAtras(minutos: number): Date {
  return new Date(Date.now() - minutos * 60_000);
}

async function main() {
  console.log('Limpando dados de demonstracao...');
  // A cascata de Connection cuida de mailboxes, mensagens e eventos.
  await prisma.user.deleteMany({ where: { email: 'demo@torre.local' } });

  const usuario = await prisma.user.create({
    data: { email: 'demo@torre.local', name: 'Demonstracao', timezone: 'America/Sao_Paulo' },
  });

  const contas = [
    {
      provider: 'GOOGLE' as Provider,
      accountEmail: 'pessoal@gmail.com',
      displayName: 'Pessoal',
      color: '#ea4335',
      status: 'ACTIVE' as const,
      lastSyncAt: minutosAtras(3),
    },
    {
      provider: 'MICROSOFT' as Provider,
      accountEmail: 'trabalho@empresa.com',
      displayName: 'Trabalho',
      color: '#0078d4',
      status: 'ACTIVE' as const,
      lastSyncAt: minutosAtras(6),
    },
    {
      provider: 'APPLE' as Provider,
      accountEmail: 'familia@icloud.com',
      displayName: 'Familia',
      color: '#8e8e93',
      // Atrasada de proposito: a Torre precisa mostrar que silencio nao e saude.
      status: 'ACTIVE' as const,
      lastSyncAt: minutosAtras(180),
    },
    {
      provider: 'IMAP_CALDAV' as Provider,
      accountEmail: 'projetos@meudominio.com.br',
      displayName: 'Projetos',
      color: '#34a853',
      // Token vencido de proposito: exercita o card vermelho de reautenticacao.
      status: 'REAUTH_REQUIRED' as const,
      lastSyncAt: minutosAtras(1440),
      lastErrorMessage: 'Senha de app rejeitada pelo servidor IMAP',
    },
  ];

  const conexoes = [];
  for (const conta of contas) {
    const conexao = await prisma.connection.create({
      data: {
        userId: usuario.id,
        provider: conta.provider,
        accountEmail: conta.accountEmail,
        displayName: conta.displayName,
        color: conta.color,
        status: conta.status,
        lastSyncAt: conta.lastSyncAt,
        lastErrorMessage: conta.lastErrorMessage ?? null,
        lastErrorAt: conta.lastErrorMessage ? minutosAtras(1440) : null,
        capabilities: CAPACIDADES[conta.provider],
      },
    });

    const caixa = await prisma.mailbox.create({
      data: {
        connectionId: conexao.id,
        providerId: 'INBOX',
        name: 'Caixa de entrada',
        role: 'INBOX',
        includeInUnified: true,
      },
    });

    const calendario = await prisma.calendarSource.create({
      data: {
        connectionId: conexao.id,
        providerId: 'primary',
        name: `Calendario ${conta.displayName}`,
        timezone: 'America/Sao_Paulo',
        color: conta.color,
        isPrimary: true,
        includeInUnified: true,
      },
    });

    for (const recurso of ['MAIL', 'CALENDAR'] as const) {
      await prisma.syncState.create({
        data: {
          connectionId: conexao.id,
          resource: recurso,
          status: conta.status === 'REAUTH_REQUIRED' ? 'FAILED' : 'IDLE',
          lastSyncAt: conta.lastSyncAt,
          lastFullSyncAt: minutosAtras(4320),
          nextRunAt: new Date(Date.now() + 300_000),
          failureCount: conta.status === 'REAUTH_REQUIRED' ? 3 : 0,
        },
      });
    }

    conexoes.push({ conexao, caixa, calendario, conta });
  }

  const [google, microsoft, apple] = conexoes;
  if (!google || !microsoft || !apple) throw new Error('Falha ao criar conexoes de demonstracao');

  console.log('Criando mensagens...');

  const mensagens = [
    {
      alvo: google,
      subject: 'Convite: Reuniao de alinhamento trimestral',
      fromName: 'Camila Duarte',
      fromEmail: 'camila@parceiro.com',
      // Mesmo Message-ID nas duas contas: e a mesma mensagem, deve deduplicar.
      rfcMessageId: '<convite-trimestral-2026@parceiro.com>',
      receivedAt: minutosAtras(220),
      isRead: false,
    },
    {
      alvo: microsoft,
      subject: 'Convite: Reuniao de alinhamento trimestral',
      fromName: 'Camila Duarte',
      fromEmail: 'camila@parceiro.com',
      rfcMessageId: '<convite-trimestral-2026@parceiro.com>',
      receivedAt: minutosAtras(220),
      isRead: false,
    },
    {
      alvo: microsoft,
      subject: 'Contrato para assinatura ate sexta',
      fromName: 'Juridico',
      fromEmail: 'juridico@empresa.com',
      rfcMessageId: '<contrato-8842@empresa.com>',
      receivedAt: minutosAtras(2880),
      isRead: false,
    },
    {
      alvo: google,
      subject: 'Sua passagem GRU-LIS foi confirmada',
      fromName: 'Reservas',
      fromEmail: 'noreply@companhia.com',
      rfcMessageId: '<bilhete-77213@companhia.com>',
      receivedAt: minutosAtras(500),
      isRead: false,
    },
    {
      alvo: apple,
      subject: 'Boleto do condominio vence em 3 dias',
      fromName: 'Administradora',
      fromEmail: 'cobranca@administradora.com.br',
      rfcMessageId: '<boleto-2026-08@administradora.com.br>',
      receivedAt: minutosAtras(90),
      isRead: false,
    },
  ];

  for (const mensagem of mensagens) {
    const dedupeKey = messageDedupeKey({
      rfcMessageId: mensagem.rfcMessageId,
      fromEmail: mensagem.fromEmail,
      subject: mensagem.subject,
      receivedAt: mensagem.receivedAt,
    });

    // upsert pela chave: a segunda copia do mesmo convite entra no mesmo item.
    const item = await prisma.unifiedItem.upsert({
      where: { userId_dedupeKey: { userId: usuario.id, dedupeKey } },
      create: {
        userId: usuario.id,
        kind: 'MESSAGE',
        dedupeKey,
        title: mensagem.subject,
        preview: `${mensagem.fromName} <${mensagem.fromEmail}>`,
        occurredAt: mensagem.receivedAt,
        copyCount: 1,
      },
      update: { copyCount: { increment: 1 } },
    });

    await prisma.message.create({
      data: {
        connectionId: mensagem.alvo.conexao.id,
        mailboxId: mensagem.alvo.caixa.id,
        providerId: `${mensagem.alvo.conexao.id}-${mensagem.rfcMessageId}`,
        rfcMessageId: mensagem.rfcMessageId,
        unifiedItemId: item.id,
        subject: mensagem.subject,
        snippet: 'Conteudo carregado sob demanda.',
        fromName: mensagem.fromName,
        fromEmail: mensagem.fromEmail,
        toEmails: [mensagem.alvo.conta.accountEmail],
        receivedAt: mensagem.receivedAt,
        isRead: mensagem.isRead,
      },
    });
  }

  console.log('Criando eventos...');

  const eventos = [
    {
      alvo: google,
      title: 'Reuniao de alinhamento trimestral',
      // Mesmo iCalUID em duas contas: uma reuniao so, nao um conflito.
      iCalUid: 'trimestral-2026-q3@parceiro.com',
      startsAt: hojeAs(10, 0),
      endsAt: hojeAs(11, 0),
      organizerEmail: 'camila@parceiro.com',
    },
    {
      alvo: microsoft,
      title: 'Reuniao de alinhamento trimestral',
      iCalUid: 'trimestral-2026-q3@parceiro.com',
      startsAt: hojeAs(10, 0),
      endsAt: hojeAs(11, 0),
      organizerEmail: 'camila@parceiro.com',
    },
    {
      alvo: microsoft,
      title: 'Revisao de arquitetura',
      iCalUid: 'revisao-arq-0912@empresa.com',
      startsAt: hojeAs(14, 0),
      endsAt: hojeAs(15, 30),
      organizerEmail: 'tech@empresa.com',
    },
    {
      alvo: google,
      // Sobrepoe a revisao acima, em outra conta: o conflito que ninguem ve hoje.
      title: 'Consulta medica',
      iCalUid: 'consulta-3311@clinica.com',
      startsAt: hojeAs(15, 0),
      endsAt: hojeAs(16, 0),
      organizerEmail: 'agenda@clinica.com',
    },
    {
      alvo: apple,
      title: 'Jantar de aniversario',
      iCalUid: 'jantar-familia-88@icloud.com',
      startsAt: hojeAs(20, 0),
      endsAt: hojeAs(22, 0),
      organizerEmail: 'familia@icloud.com',
    },
  ];

  for (const evento of eventos) {
    const dedupeKey = eventDedupeKey({
      iCalUid: evento.iCalUid,
      title: evento.title,
      startsAt: evento.startsAt,
      organizerEmail: evento.organizerEmail,
    });

    const item = await prisma.unifiedItem.upsert({
      where: { userId_dedupeKey: { userId: usuario.id, dedupeKey } },
      create: {
        userId: usuario.id,
        kind: 'EVENT',
        dedupeKey,
        title: evento.title,
        preview: evento.organizerEmail,
        occurredAt: evento.startsAt,
        copyCount: 1,
      },
      update: { copyCount: { increment: 1 } },
    });

    await prisma.calendarEvent.create({
      data: {
        connectionId: evento.alvo.conexao.id,
        calendarSourceId: evento.alvo.calendario.id,
        providerId: `${evento.alvo.conexao.id}-${evento.iCalUid}`,
        iCalUid: evento.iCalUid,
        unifiedItemId: item.id,
        title: evento.title,
        startsAt: evento.startsAt,
        endsAt: evento.endsAt,
        isAllDay: false,
        timezone: 'America/Sao_Paulo',
        status: 'CONFIRMED',
        responseStatus: 'ACCEPTED',
        organizerEmail: evento.organizerEmail,
      },
    });
  }

  console.log('Criando alertas...');

  await prisma.alert.createMany({
    data: [
      {
        userId: usuario.id,
        severity: 'CRITICAL',
        kind: 'REAUTH_NEEDED',
        title: 'projetos@meudominio.com.br precisa ser reconectada',
        detail: 'A senha de app foi rejeitada pelo servidor IMAP ha 24h.',
        dedupeKey: 'reauth:projetos@meudominio.com.br',
      },
      {
        userId: usuario.id,
        severity: 'WARN',
        kind: 'SYNC_STALE',
        title: 'familia@icloud.com sem sincronizar ha 3h',
        detail: 'Intervalo esperado para CalDAV e de 15 minutos.',
        dedupeKey: 'stale:familia@icloud.com',
      },
    ],
  });

  const totalItens = await prisma.unifiedItem.count({ where: { userId: usuario.id } });
  const totalMensagens = await prisma.message.count({ where: { connection: { userId: usuario.id } } });

  console.log(
    `Pronto: ${contas.length} contas, ${totalMensagens} copias de mensagem agrupadas em ` +
      `${totalItens} itens unificados. Rode "pnpm dev" e abra http://localhost:3000`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
