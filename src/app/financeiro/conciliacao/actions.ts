'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { sugerirPares } from '@/core/finance/conciliacao/sugerir';
import { casarManualmente, confirmarPar, desfazerDecisao, rejeitarPar } from '@/core/finance/conciliacao/decidir';

export interface ResultadoAcao {
  ok: boolean;
  erro?: string;
  texto?: string;
}

async function usuarioAtual() {
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
}

function falha(erro: unknown): ResultadoAcao {
  return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
}

export async function procurarPares(): Promise<ResultadoAcao> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sem usuário' };
  try {
    const r = await sugerirPares(u.id);
    revalidatePath('/financeiro/conciliacao');
    return {
      ok: true,
      texto: `${r.sugeridos} par(es) sugerido(s) entre ${r.lancamentosAvaliados} saídas e ${r.cobrancasAvaliadas} cobranças.`,
    };
  } catch (erro) {
    return falha(erro);
  }
}

export async function decidirPar(
  lancamentoId: string,
  decisao: 'confirmar' | 'rejeitar' | 'desfazer',
): Promise<ResultadoAcao> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sem usuário' };
  try {
    if (decisao === 'confirmar') await confirmarPar(u.id, lancamentoId);
    else if (decisao === 'rejeitar') await rejeitarPar(u.id, lancamentoId);
    else await desfazerDecisao(u.id, lancamentoId);
  } catch (erro) {
    return falha(erro);
  }
  revalidatePath('/financeiro/conciliacao');
  revalidatePath('/financeiro');
  return { ok: true };
}

export async function casarPar(lancamentoId: string, cobrancaId: string): Promise<ResultadoAcao> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sem usuário' };
  if (!cobrancaId) return { ok: false, erro: 'Escolha uma cobrança' };
  try {
    await casarManualmente(u.id, lancamentoId, cobrancaId);
  } catch (erro) {
    return falha(erro);
  }
  revalidatePath('/financeiro/conciliacao');
  revalidatePath('/financeiro');
  return { ok: true };
}
