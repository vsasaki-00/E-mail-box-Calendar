'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { aceitarProposta, rejeitarMensagem } from '@/core/whatsapp/entrada';
import { negocioValido } from '@/core/triage/negocios-dados';
import { criarCobrancaDeMensagem } from '@/core/finance/cobranca-do-whatsapp';

export interface ResultadoEntrada {
  ok: boolean;
  erro?: string;
}

async function usuarioAtual() {
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
}

/** "1.234,56" → 123456. Undefined quando não é valor. */
function centavosDoFormulario(bruto: string): number | undefined {
  const cents = Math.round(Number(bruto.replace(/\./g, '').replace(',', '.')) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : undefined;
}

/** `AAAA-MM-DD` → meio-dia de Brasília, como o resto do app. */
function dataDoFormulario(bruto: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bruto);
  if (!m) return undefined;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 15, 0, 0));
}

/** Confirmar a proposta, com o que voce eventualmente corrigiu na tela. */
export async function confirmarEntrada(
  mensagemId: string,
  _anterior: ResultadoEntrada | null,
  form: FormData,
): Promise<ResultadoEntrada> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sem usuário' };

  const amountCents = centavosDoFormulario(String(form.get('valor') ?? ''));
  if (amountCents === undefined) return { ok: false, erro: 'Informe um valor maior que zero' };

  const data = dataDoFormulario(String(form.get('data') ?? ''));
  if (!data) return { ok: false, erro: 'Data inválida' };

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

/**
 * "Isso vai vir no extrato."
 *
 * Não vira lançamento — viraria o segundo registro do mesmo pagamento, e a
 * conciliação não casa lançamento com lançamento. A mensagem passa a
 * esperar a linha certa da próxima importação, levando junto o que só você
 * sabe: para que foi e de qual negócio.
 *
 * Os campos vêm do formulário, e não da proposta original: você pode ter
 * corrigido o valor ou escolhido o negócio antes de clicar.
 */
export async function aguardarExtrato(form: FormData): Promise<void> {
  const u = await usuarioAtual();
  const mensagemId = String(form.get('mensagemId') ?? '');
  const centavos = centavosDoFormulario(String(form.get('valor') ?? ''));
  const data = dataDoFormulario(String(form.get('data') ?? ''));
  // Sem valor ou sem data a nota nao teria como casar com linha nenhuma:
  // vira uma promessa que o app nunca cumpre. Melhor nao criar.
  if (!u || !mensagemId || centavos === undefined || !data) return;

  const business = String(form.get('negocio') ?? '').trim();
  const negocioOk = business ? await negocioValido(u.id, business) : true;

  await prisma.inboxMessage.updateMany({
    where: { id: mensagemId, userId: u.id, status: { not: 'ACCEPTED' } },
    data: {
      status: 'WAITING_STATEMENT',
      proposedAmountCents: centavos,
      proposedDirection: String(form.get('direcao') ?? 'SAIDA') === 'ENTRADA' ? 'ENTRADA' : 'SAIDA',
      proposedDescription: String(form.get('descricao') ?? '').trim() || null,
      proposedDate: data,
      proposedCategory: String(form.get('categoria') ?? '').trim() || null,
      proposedBusiness: negocioOk ? business || null : null,
    },
  });

  revalidatePath('/financeiro/entrada');
  revalidatePath('/financeiro/extrato');
}

/**
 * "Isto é conta a pagar."
 *
 * Não vira lançamento: lançamento diz que o dinheiro saiu, e um boleto que
 * vence dia 31 não saiu nada. Vira cobrança, aparece em "o que vence", e o
 * pagamento é casado depois pela conciliação — igual ao boleto detectado em
 * e-mail.
 */
export async function marcarComoCobranca(mensagemId: string): Promise<ResultadoEntrada> {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: 'Sem usuário' };

  const r = await criarCobrancaDeMensagem(u.id, mensagemId);
  if (!r.ok) return { ok: false, erro: r.erro };

  revalidatePath('/financeiro/entrada');
  revalidatePath('/financeiro');
  return { ok: true };
}
