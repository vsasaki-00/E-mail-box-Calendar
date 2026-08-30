'use server';

import { revalidatePath } from 'next/cache';
import type { TriageCalibration } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isBusinessContext, parseList } from '@/core/triage/businesses';

/**
 * Salva o perfil de uma caixa. Ver docs/07-agente-de-triagem.md
 *
 * Estes campos entram no prompt de triagem de TODA mensagem daquela caixa —
 * por isso a validacao e estrita: um valor invalido aqui vira instrucao
 * errada, repetida milhares de vezes.
 */

const CALIBRACOES: TriageCalibration[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];

export interface SalvarPerfilResultado {
  ok: boolean;
  erro?: string;
}

export async function salvarPerfil(
  connectionId: string,
  _anterior: SalvarPerfilResultado | null,
  form: FormData,
): Promise<SalvarPerfilResultado> {
  const conexao = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!conexao) return { ok: false, erro: 'Conexão não encontrada' };

  const businessNameBruto = String(form.get('businessName') ?? '').trim();
  // Vazio e valido (caixa ainda sem contexto definido); valor fora da lista
  // nao, porque o nome do negocio precisa ser consistente entre caixas.
  if (businessNameBruto && !isBusinessContext(businessNameBruto)) {
    return { ok: false, erro: 'Negócio inválido' };
  }

  const calibrationBruta = String(form.get('calibration') ?? 'BALANCED');
  if (!CALIBRACOES.includes(calibrationBruta as TriageCalibration)) {
    return { ok: false, erro: 'Calibragem inválida' };
  }

  const dados = {
    businessName: businessNameBruto || null,
    role: String(form.get('role') ?? '').trim() || null,
    objective: String(form.get('objective') ?? '').trim() || null,
    calibration: calibrationBruta as TriageCalibration,
    vipSenders: parseList(String(form.get('vipSenders') ?? '')),
    urgentKeywords: parseList(String(form.get('urgentKeywords') ?? '')),
  };

  await prisma.mailboxProfile.upsert({
    where: { connectionId },
    create: { connectionId, ...dados },
    update: dados,
  });

  revalidatePath('/perfis');
  revalidatePath('/');
  return { ok: true };
}
