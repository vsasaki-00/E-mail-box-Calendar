import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { keyringFromEnv } from '@/lib/crypto';
import {
  domainFromEmail,
  guessConfigForDomain,
  imapCaldavCapabilities,
  imapCaldavConnector,
  isAppleDomain,
  type ImapCaldavConfig,
} from '@/lib/connectors/imap-caldav';
import { ConnectorError, type ConnectorContext } from '@/lib/connectors/types';
import { saveCredentials } from '@/core/sync/engine';

/**
 * Conecta uma conta IMAP/CalDAV (Apple iCloud ou generica). Sem OAuth: o
 * proprio POST testa a conexao ao vivo antes de gravar qualquer coisa — ver
 * o fluxo "teste de conexao ao vivo" descrito em docs/01-arquitetura.md.
 */

const corpoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'senha obrigatória'),
  imapHost: z.string().min(1).optional(),
  imapPort: z.number().int().positive().optional(),
  imapSecure: z.boolean().optional(),
  caldavUrl: z.string().url().optional(),
});

function statusHttpPara(erro: ConnectorError): number {
  switch (erro.code) {
    case 'AUTH_EXPIRED':
      return 401;
    case 'NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    case 'TRANSIENT':
      return 502;
    default:
      return 400;
  }
}

export async function POST(request: Request) {
  const corpo = await request.json().catch(() => null);
  const analisado = corpoSchema.safeParse(corpo);
  if (!analisado.success) {
    return NextResponse.json({ error: analisado.error.issues[0]?.message ?? 'entrada inválida' }, { status: 400 });
  }

  const { email, password, imapHost, imapPort, imapSecure, caldavUrl } = analisado.data;

  let domain: string;
  try {
    domain = domainFromEmail(email);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const sugestao = guessConfigForDomain(domain);
  const config: ImapCaldavConfig = {
    imapHost: imapHost ?? sugestao.imapHost,
    imapPort: imapPort ?? sugestao.imapPort,
    imapSecure: imapSecure ?? sugestao.imapSecure,
    caldavUrl: caldavUrl ?? sugestao.caldavUrl,
  };

  const context: ConnectorContext = {
    connectionId: 'pendente',
    accountEmail: email,
    credentials: { username: email, password },
    config: config as unknown as Record<string, unknown>,
  };

  try {
    // As duas pernas (IMAP + CalDAV) precisam responder antes de gravar
    // qualquer coisa — nunca criar uma conexao que sabemos de antemao que
    // vai falhar no primeiro sync.
    await imapCaldavConnector.verify(context);
  } catch (error) {
    const erro =
      error instanceof ConnectorError
        ? error
        : new ConnectorError('PERMANENT', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: erro.message, code: erro.code }, { status: statusHttpPara(erro) });
  }

  const usuario =
    (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })) ??
    (await prisma.user.create({ data: { email } }));

  const provider = isAppleDomain(domain) ? 'APPLE' : 'IMAP_CALDAV';

  const conexao = await prisma.connection.upsert({
    where: { userId_provider_accountEmail: { userId: usuario.id, provider, accountEmail: email } },
    create: {
      userId: usuario.id,
      provider,
      accountEmail: email,
      displayName: email,
      color: provider === 'APPLE' ? '#8e8e93' : '#34a853',
      capabilities: imapCaldavCapabilities as never,
      config: config as unknown as never,
      status: 'ACTIVE',
    },
    // Reconectar limpa o erro anterior, reativa o sync e atualiza a
    // configuracao (o usuario pode ter corrigido host/porta).
    update: { status: 'ACTIVE', lastErrorMessage: null, lastErrorAt: null, config: config as unknown as never },
  });

  await saveCredentials(conexao.id, { username: email, password }, keyringFromEnv());

  for (const resource of ['MAIL', 'CALENDAR'] as const) {
    await prisma.syncState.upsert({
      where: { connectionId_resource: { connectionId: conexao.id, resource } },
      create: { connectionId: conexao.id, resource, nextRunAt: new Date() },
      update: { nextRunAt: new Date(), status: 'IDLE', failureCount: 0 },
    });
  }

  return NextResponse.json({ connectionId: conexao.id, accountEmail: email, provider });
}
