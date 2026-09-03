import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { lerAllowlist, numeroAutorizado } from '@/core/whatsapp/seguranca';
import { assinaturaTwilioConfere, converterTwilio, urlPublica } from '@/core/whatsapp/twilio';
import {
  contextoDaResposta,
  propostaEsperandoNegocio,
  registrarEscolha,
  registrarMensagem,
} from '@/core/whatsapp/entrada';
import { interpretarEscolhaDeNegocio } from '@/core/whatsapp/escolha';
import { nomesDeNegocio } from '@/core/triage/negocios-dados';
import { montarResposta, respostaDeEscolha } from '@/core/whatsapp/resposta';
import { enriquecerComPdf } from '@/core/whatsapp/enriquecer';
import { CABECALHOS_TWIML, twimlMensagem, twimlVazio } from '@/core/whatsapp/twiml';
import { DEFAULT_TIMEZONE } from '@/core/time/zone';

/**
 * Webhook do Twilio (BSP homologado). Ver docs/11-whatsapp.md
 *
 * Publico no middleware, como o da Cloud API e os callbacks de OAuth: quem
 * chama e o Twilio, sem cookie. A porta e a ASSINATURA (HMAC-SHA1 da URL
 * mais os parametros ordenados, com o Auth Token) somada a allowlist de
 * numero — as duas obrigatorias.
 *
 * Nao ha handshake de verificacao aqui: o Twilio nao faz o GET com
 * challenge que a Meta faz.
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * Toda resposta desta rota e TwiML, nunca JSON.
 *
 * O Twilio recusa `application/json` num webhook de mensagem com o erro
 * 12300, e cada mensagem viraria um alarme no console. A nota vai num
 * comentario XML: e o unico lugar onde da para ver o que aconteceu com uma
 * mensagem recusada, que de proposito nao deixa registro no banco.
 */
function resposta(nota?: string, status = 200) {
  return new NextResponse(twimlVazio(nota), { status, headers: CABECALHOS_TWIML });
}

/**
 * Resposta COM mensagem de volta na conversa.
 *
 * So no primeiro recebimento: o Twilio reentrega o que nao recebe 200, e
 * responder de novo encheria a conversa de mensagens iguais por um problema
 * de rede.
 */
function respostaComTexto(texto: string, nota: string) {
  return new NextResponse(twimlMensagem(texto, nota), { status: 200, headers: CABECALHOS_TWIML });
}

/**
 * GET: alguem abriu a URL no navegador.
 *
 * Quase sempre e o dono, conferindo se o webhook esta no ar. Sem isto a
 * resposta era um 405 cru — "Esta pagina nao esta funcionando" — que le
 * como app quebrado quando significa o oposto: a rota existe e esta viva.
 *
 * Esta rota e publica, entao a pagina nao diz NADA sobre configuracao —
 * nem se o token existe, nem quantos numeros a allowlist tem. Isso fica em
 * /financeiro/entrada, atras da senha.
 */
export function GET() {
  const texto = [
    'Webhook do Twilio (WhatsApp) do Meridiano.',
    '',
    'Ver esta pagina significa que a rota esta publicada e no ar.',
    '',
    'Ela recebe POST — o que o Twilio envia quando chega uma mensagem. O',
    'navegador faz GET, por isso nao ha nada para mostrar aqui.',
    '',
    'Para configurar no Twilio: "When a message comes in" -> esta URL, metodo POST.',
    'O estado do canal (provedor, numeros aceitos) esta em /financeiro/entrada.',
    '',
  ].join('\n');
  return new NextResponse(texto, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return resposta('TWILIO_AUTH_TOKEN nao configurado', 503);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Corpo ilegivel: 200 para o Twilio nao reentregar para sempre algo
    // que nunca vai melhorar.
    return resposta('ignorada: corpo ilegivel');
  }

  const params: Record<string, string> = {};
  for (const [chave, valor] of form.entries()) {
    if (typeof valor === 'string') params[chave] = valor;
  }

  // A URL tem de ser a que o Twilio chamou, nao a interna da funcao.
  const url = urlPublica(request, '/api/whatsapp/twilio');
  if (!assinaturaTwilioConfere(url, params, request.headers.get('x-twilio-signature'), authToken)) {
    return resposta('assinatura invalida', 403);
  }

  const mensagem = converterTwilio(params);
  if (!mensagem) return resposta('ignorada: sem mensagem no corpo');

  // Numero de fora: descarta em silencio, ANTES de tocar o banco. Nao
  // registra, nao responde, nao conta a quem mandou o que aconteceu — e nao
  // deixa quem nao esta na lista gastar consulta.
  if (!numeroAutorizado(mensagem.fromNumber, lerAllowlist(process.env.WHATSAPP_ALLOWED_NUMBERS))) {
    return resposta('recusada: numero fora da allowlist');
  }

  // Daqui para baixo tudo toca o banco, e uma falha de banco NAO pode
  // escapar: um erro nao tratado vira 500 sem content-type, que o Twilio
  // registra como 502 Bad Gateway — um sintoma que aponta para o lugar
  // errado. Com 500 e TwiML, o Twilio reentrega, que e o certo para uma
  // falha passageira.
  try {
    const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!usuario) return resposta('ignorada: sem usuario');

    // Antes de tratar como despesa: isto e resposta a uma pergunta pendente?
    // A regra e estreita (numero do menu ou nome do negocio, sem verbo e sem
    // valor) e erra para o lado de tratar como despesa.
    // A lista vem do banco: o menu numerado precisa refletir o que voce
    // cadastrou, e "3" tem de significar o terceiro de HOJE.
    const negocios = await nomesDeNegocio(usuario.id);
    const escolha = mensagem.text ? interpretarEscolhaDeNegocio(mensagem.text, negocios) : undefined;
    if (escolha) {
      const pendente = await propostaEsperandoNegocio(usuario.id, mensagem.fromNumber);
      if (pendente) {
        const { duplicada } = await registrarEscolha(usuario.id, mensagem, pendente.id, escolha);
        if (duplicada) return resposta('duplicada: escolha ja registrada');
        return respostaComTexto(
          respostaDeEscolha(escolha, {
            amountCents: pendente.proposedAmountCents ?? undefined,
            descricao: pendente.proposedDescription ?? undefined,
          }),
          'escolha anotada',
        );
      }
      // Sem pergunta de pe, um numero solto volta a ser o que sempre foi:
      // uma mensagem sem valor reconhecivel.
    }

    const r = await registrarMensagem(usuario.id, mensagem);
    if (!r.ok) return resposta('falha ao registrar', 500);
    // Reentrega nao responde de novo: seria a mesma mensagem duas vezes na
    // conversa por causa de um problema de rede.
    if (r.duplicada) return resposta('duplicada: ja registrada');

    // PDF vira proposta ANTES de montar a resposta: senao o texto de volta
    // diria "nao consegui ler" sobre um boleto que acabou de ser lido.
    const doPdf = await enriquecerComPdf(r.id).catch(() => undefined);

    const texto = await textoDeVolta(usuario.id, usuario.timezone, r.id, doPdf, negocios);
    // So o desfecho na nota. Nunca o texto da mensagem que voce mandou.
    return texto ? respostaComTexto(texto, 'registrada') : resposta('registrada');
  } catch {
    // Sem detalhe do erro na resposta: ela sai para fora do app. O motivo
    // fica no log da funcao, onde nao vaza.
    return resposta('erro temporario', 500);
  }
}

/**
 * Monta o texto de volta, ou nada.
 *
 * Falhar aqui NAO pode custar a mensagem: ela ja esta salva. Sem resposta o
 * dono perde o aviso, mas com um erro aqui o Twilio reentregaria e a
 * mensagem viraria duas. Por isso todo o bloco cai em silencio.
 */
async function textoDeVolta(
  userId: string,
  timezone: string | null,
  mensagemId: string,
  doPdf?: { cobranca?: { instrumento?: 'BOLETO' | 'PIX'; dvConfere?: boolean }; valorDaLegenda?: number },
  negocios?: readonly string[],
) {
  try {
    const salva = await prisma.inboxMessage.findUnique({
      where: { id: mensagemId },
      select: {
        proposedAmountCents: true,
        proposedDirection: true,
        proposedDescription: true,
        proposedDate: true,
        confidence: true,
        errorMessage: true,
        kind: true,
        proposedBusiness: true,
      },
    });
    if (!salva) return undefined;

    const proposta = {
      amountCents: salva.proposedAmountCents ?? undefined,
      descricao: salva.proposedDescription ?? undefined,
      data: salva.proposedDate ?? undefined,
    };
    const ctx = await contextoDaResposta(userId, mensagemId, proposta);

    return montarResposta(
      {
        ...proposta,
        direcao: salva.proposedDirection === 'ENTRADA' ? 'ENTRADA' : 'SAIDA',
        confianca: salva.confidence ?? 0,
        // O motivo so vale a pena quando ele explica algo que a frase
        // padrao nao explica — o caso de midia sem legenda. Para texto sem
        // valor, "nao achei um valor" seria a mesma frase repetida.
        motivoFalha: salva.kind !== 'TEXT' ? (salva.errorMessage ?? undefined) : undefined,
        // So pergunta quando ha proposta de verdade e o negocio esta em
        // aberto. Perguntar em cima de "nao achei valor" seria ruido.
        perguntarNegocio: Boolean(salva.proposedAmountCents) && !salva.proposedBusiness,
        negocios,
        instrumento: doPdf?.cobranca?.instrumento,
        dvConfere: doPdf?.cobranca?.dvConfere,
        valorDaLegenda: doPdf?.valorDaLegenda,
        ...ctx,
      },
      timezone || DEFAULT_TIMEZONE,
    );
  } catch {
    return undefined;
  }
}
