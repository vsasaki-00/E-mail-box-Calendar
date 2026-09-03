'use server';

import { revalidatePath } from 'next/cache';
import type { FinancialAccountKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { negocioValido } from '@/core/triage/negocios-dados';
import { planejarExclusao, resumirPreservados } from '@/core/finance/extrato/desfazer';

/**
 * Editar uma conta: nome, banco, tipo, negocio.
 *
 * O arquivo cria a conta com o que sabe (codigo do banco, numero). O que
 * ela E para voce — "Itaú PJ da Unitedcom" — so voce sabe. Numero de
 * agencia/conta nao muda por aqui: e a identidade que faz o proximo
 * arquivo cair na conta certa.
 */

const TIPOS: FinancialAccountKind[] = ['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'CASH', 'INVESTMENT', 'OTHER'];

export interface ResultadoConta {
  ok: boolean;
  erro?: string;
}

export async function atualizarConta(
  accountId: string,
  _anterior: ResultadoConta | null,
  form: FormData,
): Promise<ResultadoConta> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  const label = String(form.get('label') ?? '').trim();
  const institution = String(form.get('institution') ?? '').trim();
  const kind = String(form.get('kind') ?? '');
  const business = String(form.get('business') ?? '').trim();

  if (!label) return { ok: false, erro: 'Dê um nome à conta' };
  if (label.length > 80) return { ok: false, erro: 'Nome longo demais (máx. 80)' };
  if (!TIPOS.includes(kind as FinancialAccountKind)) return { ok: false, erro: 'Tipo inválido' };
  if (business && !(await negocioValido(usuario.id, business))) return { ok: false, erro: 'Negócio inválido' };

  const conta = await prisma.financialAccount.findFirst({
    where: { id: accountId, userId: usuario.id },
    select: { id: true },
  });
  if (!conta) return { ok: false, erro: 'Conta não encontrada' };

  try {
    await prisma.financialAccount.update({
      where: { id: conta.id },
      data: {
        label,
        institution: institution || null,
        kind: kind as FinancialAccountKind,
        business: business || null,
      },
    });
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  revalidatePath('/financeiro/extrato');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

import { aplicarCategorias, definirCategoria } from '@/core/finance/categorizar';

export interface ResultadoCategoria {
  ok: boolean;
  erro?: string;
  texto?: string;
}

export async function categorizarLancamento(
  lancamentoId: string,
  dados: { category: string; business: string; sempre: boolean },
): Promise<ResultadoCategoria> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };
  const r = await definirCategoria({
    userId: usuario.id,
    lancamentoId,
    category: dados.category,
    business: dados.business,
    sempre: dados.sempre,
  });
  if (!r.ok) return { ok: false, erro: r.erro };
  revalidatePath('/financeiro/extrato');
  return {
    ok: true,
    texto: r.regra
      ? `Regra "${r.regra}" criada — ${r.alcancados} lançamento(s) parecido(s) atualizado(s).`
      : 'Salvo.',
  };
}

export async function categorizarTudo(): Promise<ResultadoCategoria> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };
  try {
    const r = await aplicarCategorias(usuario.id);
    revalidatePath('/financeiro/extrato');
    return { ok: true, texto: `${r.avaliados} avaliados: ${r.porRegra} por regra sua, ${r.porHeuristica} por palpite.` };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

export async function apagarRegra(regraId: string): Promise<ResultadoCategoria> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };
  await prisma.categoryRule.deleteMany({ where: { id: regraId, userId: usuario.id } });
  revalidatePath('/financeiro/extrato');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Desfazer uma importação
// ---------------------------------------------------------------------------

export interface ResultadoDesfazer {
  ok: boolean;
  erro?: string;
  apagados?: number;
  preservados?: { motivo: string; quantas: number }[];
}

/**
 * O que aconteceria se você apagasse esta importação — sem apagar nada.
 *
 * Existe para o botão poder dizer o número antes do clique. "Apagar" sem
 * dizer quanto é um pedido de confiança que esta tela não deveria fazer.
 */
export async function previaDeExclusao(importacaoId: string): Promise<ResultadoDesfazer> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  const linhas = await prisma.ledgerEntry.findMany({
    where: { statementId: importacaoId, userId: usuario.id },
    select: { id: true, categorySource: true, matchStatus: true, notes: true },
  });

  const plano = planejarExclusao(linhas);
  return { ok: true, apagados: plano.apagar.length, preservados: resumirPreservados(plano) };
}

/**
 * Apaga a importação e os lançamentos que vieram dela.
 *
 * Numa transação só: metade apagada seria pior que nada, porque ninguém
 * saberia qual metade.
 *
 * O que você tocou fica — categorizou, conciliou ou anotou. Um arquivo
 * errado não desfaz trabalho seu, e a tela diz quantas linhas ficaram e por
 * quê, em vez de sumir com elas em silêncio.
 */
export async function desfazerImportacao(importacaoId: string): Promise<ResultadoDesfazer> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  const importacao = await prisma.statementImport.findFirst({
    where: { id: importacaoId, userId: usuario.id },
    select: { id: true },
  });
  if (!importacao) return { ok: false, erro: 'Importação não encontrada' };

  const linhas = await prisma.ledgerEntry.findMany({
    where: { statementId: importacaoId, userId: usuario.id },
    select: { id: true, categorySource: true, matchStatus: true, notes: true },
  });
  const plano = planejarExclusao(linhas);

  try {
    await prisma.$transaction([
      prisma.ledgerEntry.deleteMany({ where: { id: { in: plano.apagar }, userId: usuario.id } }),
      // A relação é `onDelete: SetNull`: apagar só a importação deixaria os
      // lançamentos no lugar e sem origem. Por isso as linhas vão primeiro,
      // e as preservadas ficam explicitamente soltas.
      prisma.ledgerEntry.updateMany({
        where: { statementId: importacaoId, userId: usuario.id },
        data: { statementId: null },
      }),
      prisma.statementImport.delete({ where: { id: importacao.id } }),
    ]);
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  revalidatePath('/financeiro/extrato');
  revalidatePath('/financeiro/conciliacao');
  revalidatePath('/financeiro/analise');
  revalidatePath('/financeiro');

  return { ok: true, apagados: plano.apagar.length, preservados: resumirPreservados(plano) };
}
