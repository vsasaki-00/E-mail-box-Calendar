import type { Connection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bestBodyText } from '@/core/voice/body-text';
import { keyringFromEnv } from '@/lib/crypto';
import { buildContext } from '@/core/sync/engine';
import { getConnector } from '@/lib/connectors/registry';
import type { VoiceForDraft } from './compose';
import {
  checkDraftPreconditions,
  createAnthropicDraftModel,
  DRAFT_PROMPT_VERSION,
  generateDraft,
  type DraftModel,
  type VoiceProfileGate,
} from './generator';
import type { DraftInput, DraftMailboxContext, DraftRefused } from './types';

/**
 * Liga a geracao de rascunhos ao banco (fase 5D).
 * Ver docs/07-agente-de-triagem.md
 *
 * NADA AQUI ENVIA E-MAIL. Nao ha cliente SMTP, nao ha chamada de envio nos
 * conectores, nao ha estado "enviado" no schema. O rascunho existe para
 * voce copiar, editar e mandar voce mesmo.
 */

function lista(valor: unknown): { text: string; count: number }[] {
  return Array.isArray(valor) ? (valor as { text: string; count: number }[]) : [];
}

/** Carrega o perfil de voz da caixa no formato que a geracao usa. */
export async function loadVoiceGate(connectionId: string): Promise<VoiceProfileGate | null> {
  const perfil = await prisma.voiceProfile.findUnique({ where: { connectionId } });
  if (!perfil) return null;

  const voz: VoiceForDraft = {
    greetings: lista(perfil.greetings),
    closings: lista(perfil.closings),
    signature: perfil.signature,
    language: perfil.language,
    formality: perfil.formality,
    medianWordCount: perfil.medianWordCount,
    traits: Array.isArray(perfil.traits) ? (perfil.traits as string[]) : [],
    userNotes: perfil.userNotes,
  };

  return { voz, userApproved: perfil.userApproved, derivedAt: perfil.derivedAt };
}

export async function loadDraftContext(connection: Connection): Promise<DraftMailboxContext> {
  const perfil = await prisma.mailboxProfile.findUnique({
    where: { connectionId: connection.id },
  });

  return {
    accountEmail: connection.accountEmail,
    businessName: perfil?.businessName ?? connection.displayName,
    role: perfil?.role ?? null,
    objective: perfil?.objective ?? null,
  };
}

export interface DraftRequestResult {
  ok: boolean;
  refusal?: DraftRefused;
  error?: string;
  draftId?: string;
}

/**
 * Gera e grava o rascunho de UM item — porque e assim que voce pede: um
 * por vez, olhando para ele. Rascunho em lote seria a porta para o envio
 * automatico, que esta fase nao tem.
 */
export async function requestDraft(
  unifiedItemId: string,
  userId: string,
  direction?: string | null,
  model?: DraftModel | null,
): Promise<DraftRequestResult> {
  const mensagem = await prisma.message.findFirst({
    where: { unifiedItemId, unifiedItem: { userId } },
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      providerId: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      receivedAt: true,
      bodyText: true,
      bodyHtml: true,
      connection: true,
    },
  });
  if (!mensagem) return { ok: false, error: 'Mensagem não encontrada' };

  const conexao = mensagem.connection;

  // O corpo e buscado sob demanda, para ESTE item, porque voce pediu o
  // rascunho dele. Nunca em lote pela caixa.
  let texto = bestBodyText({ text: mensagem.bodyText, html: mensagem.bodyHtml });
  if (!texto) {
    try {
      const conector = getConnector(conexao.provider);
      const corpo = await conector.fetchMessageBody(
        buildContext(conexao, keyringFromEnv()),
        mensagem.providerId,
      );
      await prisma.message.update({
        where: { id: mensagem.id },
        data: {
          bodyText: corpo.text ?? null,
          bodyHtml: corpo.html ?? null,
          bodyFetchedAt: new Date(),
        },
      });
      texto = bestBodyText({ text: corpo.text, html: corpo.html });
    } catch {
      // Sem corpo a precondicao abaixo recusa com mensagem clara.
    }
  }

  const entrada: DraftInput = {
    id: unifiedItemId,
    fromEmail: mensagem.fromEmail,
    fromName: mensagem.fromName,
    subject: mensagem.subject,
    body: texto,
    receivedAt: mensagem.receivedAt,
    direction,
  };

  const perfil = await loadVoiceGate(conexao.id);
  const modelo = model === undefined ? criarModeloSeHouverChave() : model;

  const recusa = checkDraftPreconditions(entrada, perfil, Boolean(modelo));
  if (recusa) return { ok: false, refusal: recusa };
  if (!perfil || !modelo) return { ok: false, error: 'Pré-condições inconsistentes' };

  const contexto = await loadDraftContext(conexao);
  const gerado = await generateDraft(entrada, contexto, perfil, modelo);
  if (gerado.error) return { ok: false, error: gerado.error };

  const dados = {
    subject: gerado.subject,
    bodyGenerated: gerado.bodyGenerated,
    bodyComposed: gerado.bodyComposed,
    // Regerar zera a edicao anterior: o texto editado era de outro
    // rascunho, e manter faria a tela mostrar uma edicao que nao bate com
    // o que esta ali.
    bodyEdited: null,
    status: 'PROPOSED' as const,
    voiceProfileDerivedAt: perfil.derivedAt,
    reason: gerado.reason,
    model: modelo.name,
    promptVersion: DRAFT_PROMPT_VERSION,
  };

  const rascunho = await prisma.draft.upsert({
    where: { unifiedItemId },
    create: { unifiedItemId, userId, ...dados },
    update: dados,
  });

  return { ok: true, draftId: rascunho.id };
}

function criarModeloSeHouverChave(): DraftModel | null {
  return process.env.ANTHROPIC_API_KEY ? createAnthropicDraftModel() : null;
}

/**
 * Grava a sua edicao.
 *
 * O texto editado e o sinal mais valioso desta fase: a distancia entre o
 * que o modelo escreveu e o que voce mandou de verdade e a unica medida
 * honesta de se o rascunho esta ficando bom.
 */
export async function saveDraftEdit(unifiedItemId: string, bodyEdited: string): Promise<void> {
  await prisma.draft.update({
    where: { unifiedItemId },
    data: { bodyEdited, status: 'EDITED' },
  });
}

/**
 * Marca o rascunho como aprovado por voce.
 *
 * APROVAR NAO ENVIA. Significa "este texto esta bom, vou usar" — voce copia
 * e manda do seu cliente de e-mail. A fase 5E, se existir, e que decidiria
 * sobre envio, e com consentimento novo.
 */
export async function approveDraft(unifiedItemId: string): Promise<void> {
  await prisma.draft.update({ where: { unifiedItemId }, data: { status: 'APPROVED' } });
}

export async function discardDraft(unifiedItemId: string): Promise<void> {
  await prisma.draft.update({ where: { unifiedItemId }, data: { status: 'DISCARDED' } });
}
