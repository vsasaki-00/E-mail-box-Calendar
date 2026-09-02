'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { aceitarProposta, rejeitarMensagem } from '@/core/whatsapp/entrada';

export interface ResultadoEntrada {
  ok: boolean;
  erro?: string;
}

async function usuarioAtual() {
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
}

/** Confirmar a proposta, com o que voce eventualmente corrigiu na tela. */
export async function confirmarEntrada(
  mensagemId: string,
  _anterior: ResultadoEntrada | null,
  form: FormData,
): Promise<ResultadoEntrada> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sem usuário' };

  const valorBruto = String(form.get('valor') ?? '').replace(/\./g, '').replace(',', '.');
  const amountCents = Math.round(Number(valorBruto) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, erro: 'Informe um valor maior que zero' };
  }

  const dataBruta = String(form.get('data') ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataBruta);
  if (!m) return { ok: false, erro: 'Data inválida' };
  // Meio-dia de Brasília, como o resto do app.
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 15, 0, 0));

  const r = await aceitarProposta({
    userId: u.id,
    mensagemId,
    accountId: String(form.get('conta') ?? ''),
    amountCents,
    direcao: String(form.get('direcao') ?? 'SAIDA') === 'ENTRADA' ? 'ENTRADA' : 'SAIDA',
    descricao: String(form.get('descricao') ?? ''),
    data,
    category: String(form.get('categoria') ?? '') || undefined,
    business: String(form.get('negocio') ?? '') || undefined,
  });
  if (!r.ok) return { ok: false, erro: r.erro };

  revalidatePath('/financeiro/entrada');
  revalidatePath('/financeiro/extrato');
  return { ok: true };
}

export async function descartarEntrada(mensagemId: string): Promise<ResultadoEntrada> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sem usuário' };
  await rejeitarMensagem(u.id, mensagemId);
  revalidatePath('/financeiro/entrada');
  return { ok: true };
}
