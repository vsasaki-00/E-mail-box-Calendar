'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { approveVoiceProfile, deriveVoiceProfile } from '@/core/voice/persist';

/** Server Actions da tela de perfil de voz. Ver docs/07-agente-de-triagem.md */

export interface AcaoResultado {
  ok: boolean;
  mensagem?: string;
  erro?: string;
}

export async function derivarPerfil(
  connectionId: string,
  _anterior: AcaoResultado | null,
): Promise<AcaoResultado> {
  const conexao = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!conexao) return { ok: false, erro: 'Conexão não encontrada' };

  const resultado = await deriveVoiceProfile(conexao);
  revalidatePath('/voz');

  if (resultado.error) return { ok: false, erro: resultado.error };

  if (!resultado.saved) {
    // Explica POR QUE nao deu, em vez de so dizer que falhou — sem isso o
    // usuario nao sabe se o problema e a caixa ou o sistema.
    if (resultado.found === 0) {
      return {
        ok: false,
        erro:
          'Nenhuma mensagem enviada encontrada nesta caixa. Sincronize a conta primeiro — ' +
          'o perfil vem da pasta Enviados.',
      };
    }
    return {
      ok: false,
      erro:
        `Encontrei ${resultado.found} mensagens enviadas, mas só ${resultado.sampleCount} ` +
        'serviram (o resto é encaminhamento ou resposta curta demais). Material insuficiente ' +
        'para um perfil confiável.',
    };
  }

  const partes = [`Perfil derivado de ${resultado.sampleCount} mensagens suas`];
  if (resultado.fetched > 0) partes.push(`${resultado.fetched} corpos buscados`);
  if (resultado.fetchErrors > 0) partes.push(`${resultado.fetchErrors} falharam`);

  return { ok: true, mensagem: `${partes.join(' · ')}.` };
}

export async function aprovarPerfil(
  connectionId: string,
  _anterior: AcaoResultado | null,
  form: FormData,
): Promise<AcaoResultado> {
  try {
    await approveVoiceProfile(connectionId, String(form.get('userNotes') ?? ''));
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
  revalidatePath('/voz');
  return { ok: true, mensagem: 'Perfil validado.' };
}
