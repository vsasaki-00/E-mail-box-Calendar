import { prisma } from '@/lib/db';
import { keyringFromEnv } from '@/lib/crypto';
import { getConnector } from '@/lib/connectors/registry';
import { buildContext } from '@/core/sync/engine';
import { bestBodyText } from '@/core/voice/body-text';
import { extractAuthoredText } from '@/core/voice/extract';
import { linkNoProvedor, type LinkProvedor } from './link-provedor';

/**
 * Corpo de uma mensagem para VOCE ler — nao para o modelo.
 *
 * A triagem classifica com metadados e continua assim. Este modulo existe
 * para o passo seguinte, que e humano: ler o e-mail e decidir se a
 * classificacao esta certa. Ver docs/07-agente-de-triagem.md
 *
 * Busca sob demanda e guarda em cache na Message, exatamente como fazem o
 * rascunho, o perfil de voz e a extracao de cobranca. Nada aqui e logado:
 * o corpo vai do provedor para o banco e do banco para a sua tela.
 */

export interface CorpoParaLeitura {
  /** So o que o remetente escreveu nesta mensagem, sem o que ele citou. */
  textoNovo: string;
  /** Tudo, citacoes incluidas. */
  textoCompleto: string;
  /** HTML bruto, para a visao formatada em sandbox. Ausente se nao houver. */
  html?: string;
  de: string;
  para: string[];
  recebidoEm: Date;
  /** Em qual caixa esta copia esta. */
  caixa: string;
  link?: LinkProvedor;
  /** Quando o corpo veio do provedor agora, e nao do cache. */
  buscadoAgora: boolean;
}

export type ResultadoCorpo =
  | { ok: true; corpo: CorpoParaLeitura }
  | { ok: false; erro: string; status: 404 | 409 | 502 };

export async function obterCorpo(unifiedItemId: string, userId: string): Promise<ResultadoCorpo> {
  // O mesmo e-mail pode existir em varias caixas. Prefere a copia que ja
  // tem corpo (custo zero), depois a de uma conexao ativa.
  const copias = await prisma.message.findMany({
    where: { unifiedItemId, connection: { userId } },
    include: { connection: true },
    orderBy: { receivedAt: 'desc' },
  });
  if (copias.length === 0) {
    return { ok: false, erro: 'Mensagem não encontrada nesta conta', status: 404 };
  }

  const comCorpo = copias.find((m) => m.bodyText || m.bodyHtml);
  const ativa = copias.find((m) => m.connection.status === 'ACTIVE');
  const mensagem = comCorpo ?? ativa ?? copias[0]!;

  let bodyText = mensagem.bodyText;
  let bodyHtml = mensagem.bodyHtml;
  let buscadoAgora = false;

  if (!bodyText && !bodyHtml) {
    if (mensagem.connection.status !== 'ACTIVE') {
      return {
        ok: false,
        erro: 'A caixa desta mensagem precisa ser reconectada para buscar o conteúdo',
        status: 409,
      };
    }
    try {
      const conector = getConnector(mensagem.connection.provider);
      const contexto = buildContext(mensagem.connection, keyringFromEnv());
      const corpo = await conector.fetchMessageBody(contexto, mensagem.providerId);
      bodyText = corpo.text ?? null;
      bodyHtml = corpo.html ?? null;
      buscadoAgora = true;
      await prisma.message.update({
        where: { id: mensagem.id },
        data: { bodyText, bodyHtml, bodyFetchedAt: new Date() },
      });
    } catch (erro) {
      // A mensagem de erro do conector e segura (nao carrega corpo); o que
      // NAO se faz aqui e console.log do que veio.
      return {
        ok: false,
        erro: `Não consegui buscar o conteúdo no provedor: ${erro instanceof Error ? erro.message : 'falha desconhecida'}`,
        status: 502,
      };
    }
  }

  const textoCompleto = bestBodyText({ text: bodyText, html: bodyHtml });
  // Se a extracao autoral devolver vazio (mensagem que e SO citacao, ou
  // marcador nao reconhecido), o completo e melhor que nada.
  const textoNovo = extractAuthoredText(textoCompleto).trim() || textoCompleto;

  const para = Array.isArray(mensagem.toEmails)
    ? (mensagem.toEmails as unknown[]).filter((e): e is string => typeof e === 'string')
    : [];

  return {
    ok: true,
    corpo: {
      textoNovo,
      textoCompleto,
      html: bodyHtml ?? undefined,
      de: mensagem.fromName
        ? `${mensagem.fromName} <${mensagem.fromEmail ?? ''}>`
        : (mensagem.fromEmail ?? '(remetente desconhecido)'),
      para,
      recebidoEm: mensagem.receivedAt,
      caixa: mensagem.connection.accountEmail,
      link: linkNoProvedor({
        provider: mensagem.connection.provider,
        accountEmail: mensagem.connection.accountEmail,
        providerId: mensagem.providerId,
      }),
      buscadoAgora,
    },
  };
}
