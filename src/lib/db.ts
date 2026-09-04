import { PrismaClient } from '@prisma/client';

/**
 * UM PrismaClient por processo — inclusive em produção.
 *
 * O cache no `globalThis` existia só fora de produção, por causa do hot
 * reload do Next, que recria módulos a cada edição. Em produção ele estava
 * desligado, e a suposição por trás disso ("em produção o módulo é avaliado
 * uma vez") não vale numa função serverless: o servidor do Next monta um
 * bundle por rota, e uma instância que atende rotas diferentes pode acabar
 * com VÁRIOS clientes, cada um abrindo o seu próprio pool.
 *
 * Cada pool são 5 conexões (`connection_limit` na DATABASE_URL). Três
 * clientes na mesma instância pedem 15, e o pooler do Supabase — que tem o
 * seu próprio teto — passa a recusar. O sintoma não diz nada disso:
 *
 *     Timed out fetching a new connection from the connection pool
 *
 * e ele aparece na consulta mais banal, porque a vítima é quem chegou por
 * último. Quando toda consulta espera os 20s do timeout, uma sincronização
 * incremental de uma conta em dia — que deveria levar dois segundos — estoura
 * os 60s da plataforma e vira FUNCTION_INVOCATION_TIMEOUT.
 *
 * O cache no `globalThis` é o padrão recomendado para Prisma em serverless
 * justamente por isso, e não custa nada: em produção ele só garante que a
 * segunda avaliação do módulo reaproveite o cliente da primeira.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

globalForPrisma.prisma = prisma;
