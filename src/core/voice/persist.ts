import type { Connection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { keyringFromEnv } from '@/lib/crypto';
import { buildContext } from '@/core/sync/engine';
import { getConnector } from '@/lib/connectors/registry';
import { bestBodyText } from './body-text';
import { buildVoiceProfile, MIN_SAMPLES_FOR_PROFILE, type SentMessageSample } from './extract';

/**
 * Job que deriva o perfil de voz da pasta Enviados. Ver docs/07-agente-de-triagem.md
 *
 * PRIVACIDADE: este job **nao faz nenhuma chamada a API de modelo**. Ele le
 * os corpos das suas mensagens enviadas do provedor e processa tudo
 * localmente com funcoes puras. Nenhum texto seu sai da maquina aqui — ao
 * contrario da triagem, que envia metadados, e da redacao (fase 5D), que
 * enviara o thread sob demanda.
 */

/** Quantas mensagens enviadas alimentam o perfil. */
export const MAX_SAMPLES = 60;
/** Corpos buscados por execucao: cada um e uma chamada ao provedor. */
export const MAX_BODY_FETCHES = 40;
/** Buscas simultaneas. Provedor limita, e derrubar a conexao nao ajuda. */
const FETCH_CONCURRENCY = 4;

export interface DeriveVoiceResult {
  connectionId: string;
  accountEmail: string;
  /** Mensagens enviadas encontradas no cache. */
  found: number;
  /** Corpos buscados do provedor nesta execucao. */
  fetched: number;
  /** Falhas ao buscar corpo. Toleradas: a amostra so fica de fora. */
  fetchErrors: number;
  /** Amostras que entraram no perfil (autorais e de tamanho util). */
  sampleCount: number;
  /** Perfil salvo? Falso quando nao houve material suficiente. */
  saved: boolean;
  error?: string;
}

async function emLotes<T, R>(itens: T[], tamanho: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  }
  return saida;
}

/**
 * Deriva e salva o perfil de voz de uma conexao.
 *
 * Nunca lanca: uma caixa com problema nao pode impedir as outras — mesma
 * degradacao por conexao do motor de sync.
 */
export async function deriveVoiceProfile(connection: Connection): Promise<DeriveVoiceResult> {
  const base = { connectionId: connection.id, accountEmail: connection.accountEmail };

  try {
    // Mensagens da pasta Enviados. O conector IMAP foi ajustado para
    // sincronizar SENT justamente por causa deste job.
    const enviadas = await prisma.message.findMany({
      where: { connectionId: connection.id, mailbox: { role: 'SENT' } },
      orderBy: { receivedAt: 'desc' },
      take: MAX_SAMPLES,
      select: {
        id: true,
        providerId: true,
        subject: true,
        receivedAt: true,
        toEmails: true,
        ccEmails: true,
        bodyText: true,
        bodyHtml: true,
      },
    });

    if (enviadas.length === 0) {
      return { ...base, found: 0, fetched: 0, fetchErrors: 0, sampleCount: 0, saved: false };
    }

    // O corpo e carregado sob demanda no sync normal (custo de quota e de
    // banco), entao a maioria vem vazia na primeira execucao.
    const semCorpo = enviadas.filter((m) => !m.bodyText && !m.bodyHtml).slice(0, MAX_BODY_FETCHES);

    let fetched = 0;
    let fetchErrors = 0;

    if (semCorpo.length > 0) {
      const conector = getConnector(connection.provider);
      const contexto = buildContext(connection, keyringFromEnv());

      await emLotes(semCorpo, FETCH_CONCURRENCY, async (mensagem) => {
        try {
          const corpo = await conector.fetchMessageBody(contexto, mensagem.providerId);
          await prisma.message.update({
            where: { id: mensagem.id },
            data: {
              bodyText: corpo.text ?? null,
              bodyHtml: corpo.html ?? null,
              bodyFetchedAt: new Date(),
            },
          });
          // Atualiza em memoria para nao reconsultar o banco.
          mensagem.bodyText = corpo.text ?? null;
          mensagem.bodyHtml = corpo.html ?? null;
          fetched += 1;
        } catch {
          // Um corpo que nao veio so deixa aquela amostra de fora.
          fetchErrors += 1;
        }
      });
    }

    const amostras: SentMessageSample[] = enviadas
      .map((m) => {
        const to = Array.isArray(m.toEmails) ? (m.toEmails as string[]) : [];
        const cc = Array.isArray(m.ccEmails) ? (m.ccEmails as string[]) : [];
        return {
          id: m.id,
          subject: m.subject,
          // Normaliza os tres formatos de corpo dos conectores.
          body: bestBodyText({ text: m.bodyText, html: m.bodyHtml }),
          sentAt: m.receivedAt,
          recipientCount: to.length + cc.length,
        };
      })
      .filter((a) => a.body.length > 0);

    const perfil = buildVoiceProfile(amostras);

    // Perfil magro demais nao e salvo: melhor a UI dizer "material
    // insuficiente" do que gravar um perfil que induziria rascunho ruim.
    if (perfil.sampleCount < MIN_SAMPLES_FOR_PROFILE) {
      return {
        ...base,
        found: enviadas.length,
        fetched,
        fetchErrors,
        sampleCount: perfil.sampleCount,
        saved: false,
      };
    }

    const dados = {
      greetings: perfil.greetings as unknown as object,
      closings: perfil.closings as unknown as object,
      signature: perfil.signature,
      avgWordCount: perfil.avgWordCount,
      medianWordCount: perfil.medianWordCount,
      formality: perfil.formality,
      language: perfil.language,
      traits: perfil.traits as unknown as object,
      sampleCount: perfil.sampleCount,
      derivedAt: new Date(),
      // Rederivar reseta a aprovacao: voce aprovou um perfil especifico, e
      // este e outro. Fingir que a aprovacao antiga vale seria mentir.
      userApproved: false,
    };

    await prisma.voiceProfile.upsert({
      where: { connectionId: connection.id },
      create: { connectionId: connection.id, ...dados },
      update: dados,
    });

    return {
      ...base,
      found: enviadas.length,
      fetched,
      fetchErrors,
      sampleCount: perfil.sampleCount,
      saved: true,
    };
  } catch (erro) {
    return {
      ...base,
      found: 0,
      fetched: 0,
      fetchErrors: 0,
      sampleCount: 0,
      saved: false,
      error: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

/** Marca o perfil como validado pelo usuario ("é assim que eu escrevo"). */
export async function approveVoiceProfile(connectionId: string, notes?: string): Promise<void> {
  await prisma.voiceProfile.update({
    where: { connectionId },
    data: { userApproved: true, userNotes: notes?.trim() || null },
  });
}
