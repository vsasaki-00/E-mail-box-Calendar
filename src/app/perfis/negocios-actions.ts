'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import {
  apagarNegocio,
  arquivarNegocio,
  criarNegocio,
  renomearNegocio,
  type Resultado,
} from '@/core/triage/negocios-dados';

/**
 * Cadastrar, renomear e arquivar negócios. Ver docs/07-agente-de-triagem.md
 *
 * O trabalho de verdade está em `core/triage/negocios-dados.ts` — aqui só a
 * borda: achar o usuário, chamar, e invalidar as telas que mostram nome de
 * negócio. Renomear muda texto em cinco tabelas; se as telas não fossem
 * invalidadas, você veria o nome novo num lugar e o antigo em outro.
 */

const TELAS = ['/perfis', '/financeiro', '/financeiro/extrato', '/financeiro/entrada', '/financeiro/analise'];

async function comUsuario(fn: (userId: string) => Promise<Resultado>): Promise<Resultado> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  const r = await fn(usuario.id);
  if (r.ok) for (const t of TELAS) revalidatePath(t);
  return r;
}

export async function acaoCriarNegocio(nome: string): Promise<Resultado> {
  return comUsuario((userId) => criarNegocio(userId, nome));
}

export async function acaoRenomearNegocio(id: string, nome: string): Promise<Resultado> {
  return comUsuario((userId) => renomearNegocio(userId, id, nome));
}

export async function acaoArquivarNegocio(id: string, arquivado: boolean): Promise<Resultado> {
  return comUsuario((userId) => arquivarNegocio(userId, id, arquivado));
}

export async function acaoApagarNegocio(id: string): Promise<Resultado> {
  return comUsuario((userId) => apagarNegocio(userId, id));
}
