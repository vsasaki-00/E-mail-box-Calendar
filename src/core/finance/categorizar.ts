import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { categoriaHeuristica, chaveDeRegra, isCategoria } from './categorias';
import { isBusinessContext } from '@/core/triage/businesses';

/**
 * Categorias no razao: regras suas primeiro, palpites embutidos depois, e
 * nada sobrescreve o que voce definiu a mao. Ver docs/10-financeiro.md
 *
 * Uma regra e um conjunto de palavras (`pattern`) da descricao normalizada;
 * casa quando TODAS aparecem como palavra. E "contem palavras", nao
 * substring: "porto seguro saude" precisa casar "efetuado porto seguro
 * seguro saude sa", que nao contem a chave contigua.
 */

export interface ResultadoCategorizacao {
  avaliados: number;
  porRegra: number;
  porHeuristica: number;
}

function casa(pattern: string, normalized: string): boolean {
  const palavras = new Set(normalized.split(' '));
  return pattern.split(' ').every((p) => palavras.has(p));
}

/**
 * Passa regras e heuristicas em tudo que ainda nao e seu.
 *
 * Em memoria: a regra casa por palavras, que o SQL nao faz de graca, e o
 * volume e de centenas de linhas por conta — nao de milhoes.
 */
export async function aplicarCategorias(userId: string): Promise<ResultadoCategorizacao> {
  const [regras, lancamentos] = await Promise.all([
    prisma.categoryRule.findMany({ where: { userId } }),
    prisma.ledgerEntry.findMany({
      where: { userId, OR: [{ categorySource: null }, { categorySource: { not: 'USER' } }] },
      select: {
        id: true,
        normalized: true,
        amountCents: true,
        category: true,
        categorySource: true,
        business: true,
        account: { select: { business: true } },
      },
    }),
  ]);

  let porRegra = 0;
  let porHeuristica = 0;
  const hits = new Map<string, number>();
  const atualizacoes: Prisma.PrismaPromise<unknown>[] = [];

  for (const l of lancamentos) {
    const regra = regras.find((r) => casa(r.pattern, l.normalized));
    if (regra) {
      const dados: { category?: string; categorySource?: string; business?: string } = {};
      if (regra.category && (l.category !== regra.category || l.categorySource !== 'RULE')) {
        dados.category = regra.category;
        dados.categorySource = 'RULE';
      }
      // Negocio: a regra so mexe se o lancamento ainda esta no padrao da
      // conta — um negocio trocado a mao nesse lancamento e seu.
      if (regra.business && l.business === (l.account.business ?? null) && l.business !== regra.business) {
        dados.business = regra.business;
      }
      if (Object.keys(dados).length > 0) {
        atualizacoes.push(prisma.ledgerEntry.update({ where: { id: l.id }, data: dados }));
        porRegra += 1;
        hits.set(regra.id, (hits.get(regra.id) ?? 0) + 1);
      }
      continue;
    }

    if (!l.category) {
      const palpite = categoriaHeuristica(l.normalized, l.amountCents);
      if (palpite) {
        atualizacoes.push(
          prisma.ledgerEntry.update({
            where: { id: l.id },
            data: { category: palpite, categorySource: 'HEURISTIC' },
          }),
        );
        porHeuristica += 1;
      }
    }
  }

  for (const [id, n] of hits) {
    atualizacoes.push(prisma.categoryRule.update({ where: { id }, data: { hits: { increment: n } } }));
  }

  // Em lotes: uma transacao com centenas de updates cabe; com milhares, nao.
  for (let i = 0; i < atualizacoes.length; i += 200) {
    await prisma.$transaction(atualizacoes.slice(i, i + 200));
  }

  return { avaliados: lancamentos.length, porRegra, porHeuristica };
}

export interface DefinirParams {
  userId: string;
  lancamentoId: string;
  category?: string | null;
  business?: string | null;
  /** Vira regra para os parecidos. */
  sempre: boolean;
}

export interface ResultadoDefinicao {
  ok: true;
  /** A chave da regra criada, se "sempre". */
  regra?: string;
  /** Quantos outros lancamentos a regra alcancou agora. */
  alcancados: number;
}

/** Voce categorizou um lancamento. Com "sempre", vira regra e se espalha. */
export async function definirCategoria(params: DefinirParams): Promise<ResultadoDefinicao | { ok: false; erro: string }> {
  const l = await prisma.ledgerEntry.findFirst({
    where: { id: params.lancamentoId, userId: params.userId },
    select: { id: true, normalized: true },
  });
  if (!l) return { ok: false, erro: 'Lançamento não encontrado' };

  const category = params.category === undefined ? undefined : params.category || null;
  const business = params.business === undefined ? undefined : params.business || null;
  if (category && !isCategoria(category)) return { ok: false, erro: 'Categoria inválida' };
  if (business && !isBusinessContext(business)) return { ok: false, erro: 'Negócio inválido' };

  await prisma.ledgerEntry.update({
    where: { id: l.id },
    data: {
      ...(category !== undefined ? { category, categorySource: category ? 'USER' : null } : {}),
      ...(business !== undefined ? { business } : {}),
    },
  });

  if (!params.sempre) return { ok: true, alcancados: 0 };

  const chave = chaveDeRegra(l.normalized);
  if (!chave) return { ok: true, alcancados: 0 };

  await prisma.categoryRule.upsert({
    where: { userId_pattern: { userId: params.userId, pattern: chave } },
    create: { userId: params.userId, pattern: chave, category: category ?? null, business: business ?? null },
    update: {
      ...(category !== undefined ? { category } : {}),
      ...(business !== undefined ? { business } : {}),
    },
  });

  const r = await aplicarCategorias(params.userId);
  return { ok: true, regra: chave, alcancados: r.porRegra };
}
