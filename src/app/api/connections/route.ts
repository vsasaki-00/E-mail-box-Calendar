import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** Lista as conexoes do usuario, sem nenhum campo de segredo. */
export async function GET() {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return NextResponse.json({ connections: [] });

  const conexoes = await prisma.connection.findMany({
    where: { userId: usuario.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      provider: true,
      accountEmail: true,
      displayName: true,
      color: true,
      status: true,
      lastSyncAt: true,
      lastErrorMessage: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ connections: conexoes });
}
