'use server';

import { revalidatePath } from 'next/cache';
import type { TriageCategory, TriagePriority } from '@prisma/client';
import { prisma } from '@/lib/db';
import { applyUserCorrection, confirmUserTriage } from '@/core/triage/persist';

/**
 * Correcao da triagem pelo usuario. Ver docs/07-agente-de-triagem.md
 *
 * Cada correcao vira registro em `TriageFeedback` — e a informacao mais
 * valiosa do sistema. Sem capturar isso, o agente nunca melhora e o usuario
 * desiste dele em tres semanas.
 */

const CATEGORIAS: TriageCategory[] = [
  'COBRANCA',
  'NEEDS_REPLY',
  'INFORMATIVE',
  'PROMOTIONAL',
  'SPAM',
  'DISPOSABLE',
];

const PRIORIDADES: TriagePriority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

export interface CorrigirResultado {
  ok: boolean;
  erro?: string;
}

export async function corrigirTriagem(
  unifiedItemId: string,
  _anterior: CorrigirResultado | null,
  form: FormData,
): Promise<CorrigirResultado> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  const categoria = String(form.get('category') ?? '');
  const prioridade = String(form.get('priority') ?? '');
  if (!CATEGORIAS.includes(categoria as TriageCategory)) {
    return { ok: false, erro: 'Categoria inválida' };
  }
  if (!PRIORIDADES.includes(prioridade as TriagePriority)) {
    return { ok: false, erro: 'Prioridade inválida' };
  }

  try {
    await applyUserCorrection({
      unifiedItemId,
      userId: usuario.id,
      category: categoria as TriageCategory,
      priority: prioridade as TriagePriority,
      // Checkbox ausente no FormData significa desmarcado.
      needsReply: form.get('needsReply') === 'on',
    });
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  revalidatePath('/triagem');
  revalidatePath('/');
  return { ok: true };
}

export interface CorrigirLoteResultado {
  ok: boolean;
  corrigidos?: number;
  erro?: string;
}

/**
 * Corrige VARIAS mensagens de uma vez. Ver docs/07-agente-de-triagem.md
 *
 * A correcao item a item pressupoe que o modelo acerta a maioria. Quando ele
 * erra em bloco — uma chave mal configurada, um perfil de caixa vazio, uma
 * leva de promocoes marcada como "precisa resposta" — corrigir de uma em uma
 * e trabalho manual que o app deveria absorver.
 *
 * Cada item vira um TriageFeedback proprio, exatamente como na correcao
 * individual: e o feedback que calibra o sistema, e um lote nao pode valer
 * menos que a soma das partes.
 */
export async function corrigirLote(
  ids: string[],
  categoria: string,
  prioridade: string,
  needsReply: boolean,
): Promise<CorrigirLoteResultado> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  if (ids.length === 0) return { ok: false, erro: 'Nenhuma mensagem selecionada' };
  // Teto de sanidade: um lote gigante vindo de uma chamada torta nao deve
  // reescrever a caixa inteira numa transacao so.
  if (ids.length > 500) return { ok: false, erro: 'Lote grande demais (máx. 500)' };

  if (!CATEGORIAS.includes(categoria as TriageCategory)) {
    return { ok: false, erro: 'Categoria inválida' };
  }
  if (!PRIORIDADES.includes(prioridade as TriagePriority)) {
    return { ok: false, erro: 'Prioridade inválida' };
  }

  let corrigidos = 0;
  const falhas: string[] = [];

  for (const unifiedItemId of ids) {
    try {
      await applyUserCorrection({
        unifiedItemId,
        userId: usuario.id,
        category: categoria as TriageCategory,
        priority: prioridade as TriagePriority,
        needsReply,
      });
      corrigidos += 1;
    } catch (erro) {
      // Uma falha nao aborta o lote: o que deu certo fica gravado, e o
      // resultado diz quantos ficaram de fora.
      falhas.push(erro instanceof Error ? erro.message : String(erro));
    }
  }

  revalidatePath('/triagem');
  revalidatePath('/');

  if (falhas.length > 0) {
    return {
      ok: corrigidos > 0,
      corrigidos,
      erro: `${falhas.length} não puderam ser corrigidas: ${falhas[0]}`,
    };
  }
  return { ok: true, corrigidos };
}

export interface ZerarResultado {
  ok: boolean;
  apagadas?: number;
  preservadas?: number;
  erro?: string;
}

/**
 * Apaga classificacoes automaticas para que possam ser refeitas.
 *
 * Existe por causa de um episodio concreto: uma variavel de ambiente vazia
 * fez toda a triagem falhar, e as mensagens ficaram gravadas com o resultado
 * do fallback ("precisa resposta", confianca 0). Sem isto, a unica saida
 * seria corrigir cinquenta itens a mao ou conviver com dados errados.
 *
 * NUNCA apaga o que veio de voce (`source: USER`), nem o historico de
 * TriageFeedback. Suas correcoes sao a materia-prima da calibragem — um
 * botao de "refazer" que as destruisse trocaria um problema recuperavel por
 * um irreversivel.
 */
export async function zerarTriagensAutomaticas(): Promise<ZerarResultado> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  let apagadas = 0;
  let preservadas = 0;
  try {
    preservadas = await prisma.itemTriage.count({
      where: { userId: usuario.id, source: 'USER' },
    });
    const resultado = await prisma.itemTriage.deleteMany({
      where: { userId: usuario.id, source: { not: 'USER' } },
    });
    apagadas = resultado.count;
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  // Fora do try de proposito: a essa altura o trabalho JA foi feito. Se a
  // revalidacao falhar, reportar erro faria voce clicar de novo numa
  // operacao que deu certo — o cache desatualizado e o mal menor, e some no
  // proximo carregamento.
  try {
    revalidatePath('/triagem');
    revalidatePath('/');
  } catch {
    // Nada a fazer: o dado ja esta correto no banco.
  }

  return { ok: true, apagadas, preservadas };
}

/**
 * "Confirmo": voce leu e a classificacao esta certa.
 *
 * E o outro lado do "discordo". Sem o sinal positivo, a calibragem so
 * enxerga erro — nunca acerto — e precisao vira um numero que ninguem
 * consegue calcular.
 */
export async function confirmarTriagem(unifiedItemId: string): Promise<CorrigirResultado> {
  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return { ok: false, erro: 'Sem usuário' };

  try {
    await confirmUserTriage({ unifiedItemId, userId: usuario.id });
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  revalidatePath('/triagem');
  revalidatePath('/');
  return { ok: true };
}
