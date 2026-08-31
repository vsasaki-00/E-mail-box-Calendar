'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { correctBill, extractBillsForConnection, setBillStatus } from '@/core/finance/persist';

/** Server Actions do painel financeiro. Ver docs/07-agente-de-triagem.md */

export interface AcaoResultado {
  ok: boolean;
  mensagem?: string;
  erro?: string;
}

export async function extrairCobrancas(_anterior: AcaoResultado | null): Promise<AcaoResultado> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Nenhum usuário' };

  const conexoes = await prisma.connection.findMany({ where: { userId: usuario.id } });
  if (conexoes.length === 0) return { ok: false, erro: 'Nenhuma conta conectada' };

  const resumos = [];
  for (const conexao of conexoes) {
    resumos.push(await extractBillsForConnection(conexao, usuario.id));
  }
  revalidatePath('/financeiro');

  const encontradas = resumos.reduce((s, r) => s + r.found, 0);
  const extraidas = resumos.reduce((s, r) => s + r.extracted, 0);
  const comInstrumento = resumos.reduce((s, r) => s + r.withInstrument, 0);
  const falhas = resumos.filter((r) => r.error);

  if (encontradas === 0) {
    return {
      ok: false,
      erro:
        'Nenhuma cobrança nova para extrair. O painel usa o que a triagem marcou ' +
        'como COBRANÇA — rode a triagem primeiro, em /triagem.',
    };
  }

  const partes = [`${extraidas} cobrança${extraidas === 1 ? '' : 's'} extraída${extraidas === 1 ? '' : 's'}`];
  if (comInstrumento > 0) partes.push(`${comInstrumento} com boleto ou PIX lido direto`);
  if (falhas.length > 0) partes.push(`${falhas.length} caixa(s) com erro`);

  return { ok: true, mensagem: `${partes.join(' · ')}.` };
}

export async function marcarStatus(
  unifiedItemId: string,
  status: 'PENDING' | 'PAID' | 'IGNORED',
): Promise<void> {
  await setBillStatus(unifiedItemId, status);
  revalidatePath('/financeiro');
}

export async function corrigirCobranca(
  unifiedItemId: string,
  _anterior: AcaoResultado | null,
  form: FormData,
): Promise<AcaoResultado> {
  const valorBruto = String(form.get('valor') ?? '').trim();
  const vencimentoBruto = String(form.get('vencimento') ?? '').trim();

  // Aceita "1.234,56" e "1234.56" — o usuario digita como pensa.
  let amountCents: number | null | undefined;
  if (valorBruto) {
    const normalizado = valorBruto.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
    const numero = Number(normalizado);
    if (!Number.isFinite(numero) || numero < 0) {
      return { ok: false, erro: `Não entendi o valor "${valorBruto}".` };
    }
    amountCents = Math.round(numero * 100);
  }

  let dueDate: Date | null | undefined;
  if (vencimentoBruto) {
    // Meio-dia UTC: meia-noite viraria o dia anterior em Brasília.
    const data = new Date(`${vencimentoBruto}T12:00:00.000Z`);
    if (Number.isNaN(data.getTime())) return { ok: false, erro: 'Data de vencimento inválida.' };
    dueDate = data;
  }

  try {
    await correctBill({
      unifiedItemId,
      amountCents,
      dueDate,
      payee: String(form.get('payee') ?? '').trim() || undefined,
      userNotes: String(form.get('userNotes') ?? ''),
    });
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  revalidatePath('/financeiro');
  return { ok: true, mensagem: 'Corrigido.' };
}
