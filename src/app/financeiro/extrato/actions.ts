'use server';

import { revalidatePath } from 'next/cache';
import type { FinancialAccountKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isBusinessContext } from '@/core/triage/businesses';

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
  if (business && !isBusinessContext(business)) return { ok: false, erro: 'Negócio inválido' };

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
