import { PrismaClient } from '@prisma/client';

/**
 * Singleton do Prisma. O hot reload do Next recria modulos a cada edicao;
 * sem o cache no globalThis isso abre uma conexao nova a cada vez ate estourar
 * o pool do Postgres.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
