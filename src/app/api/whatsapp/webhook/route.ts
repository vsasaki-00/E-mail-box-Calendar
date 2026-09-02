import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assinaturaConfere, lerAllowlist, normalizarNumero, numeroAutorizado } from '@/core/whatsapp/seguranca';
import { registrarMensagem, type MensagemRecebida } from '@/core/whatsapp/entrada';

/**
 * Webhook da Cloud API do WhatsApp. Ver docs/11-whatsapp.md
 *
 * Publico no middleware, como os callbacks de OAuth: quem chama e a Meta,
 * sem cookie. A porta e a ASSINATURA (HMAC do corpo cru com o App Secret),
 * mais a allowlist de numero — as duas obrigatorias.
 *
 * Responde 200 em quase tudo, de proposito. A Meta REENTREGA o que nao
 * recebe 200, e ficar reentregando uma mensagem que este app decidiu
 * recusar so gera ruido — a recusa e definitiva, nao um erro temporario.
 * O 403 fica so para assinatura errada, que e a unica coisa que a Meta
 * nunca deveria mandar.
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/** Verificacao do webhook: a Meta chama uma vez, no cadastro. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!token) {
    return new NextResponse('WHATSAPP_VERIFY_TOKEN não configurado', { status: 503 });
  }
  if (params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === token) {
    // A Meta espera o challenge cru, em texto.
    return new NextResponse(params.get('hub.challenge') ?? '', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }
  return new NextResponse('Verificação recusada', { status: 403 });
}

interface GraphMensagem {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
}

interface GraphPayload {
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: GraphMensagem[];
      };
    }[];
  }[];
}

/** Achata o payload aninhado da Meta em mensagens. */
function extrairMensagens(payload: GraphPayload): { msg: GraphMensagem; nome?: string }[] {
  const saida: { msg: GraphMensagem; nome?: string }[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const valor = change.value;
      const nomePorNumero = new Map(
        (valor?.contacts ?? []).map((c) => [c.wa_id ?? '', c.profile?.name]),
      );
      for (const msg of valor?.messages ?? []) {
        saida.push({ msg, nome: nomePorNumero.get(msg.from ?? '') });
      }
    }
  }
  return saida;
}

function converter(msg: GraphMensagem, nome?: string): MensagemRecebida | undefined {
  if (!msg.id || !msg.from) return undefined;

  // `timestamp` vem em SEGUNDOS. Multiplicar errado joga a mensagem para
  // 1970 e ela some do topo da fila.
  const segundos = Number(msg.timestamp);
  const receivedAt = Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date();

  const base = {
    externalId: msg.id,
    fromNumber: normalizarNumero(msg.from),
    fromName: nome,
    receivedAt,
  };

  switch (msg.type) {
    case 'text':
      return { ...base, kind: 'TEXT', text: msg.text?.body };
    case 'image':
      return { ...base, kind: 'IMAGE', text: msg.image?.caption, mediaId: msg.image?.id, mediaMimeType: msg.image?.mime_type };
    case 'document':
      return {
        ...base,
        kind: 'DOCUMENT',
        text: msg.document?.caption,
        mediaId: msg.document?.id,
        mediaMimeType: msg.document?.mime_type,
        mediaFileName: msg.document?.filename,
      };
    case 'audio':
      return { ...base, kind: 'AUDIO', mediaId: msg.audio?.id, mediaMimeType: msg.audio?.mime_type };
    default:
      // Sticker, localizacao, contato: registra o tipo e deixa para voce.
      return { ...base, kind: (msg.type ?? 'OUTRO').toUpperCase() };
  }
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: 'WHATSAPP_APP_SECRET não configurado' }, { status: 503 });
  }

  // Corpo CRU: reserializar quebraria a assinatura.
  const corpoCru = await request.text();
  if (!assinaturaConfere(corpoCru, request.headers.get('x-hub-signature-256'), appSecret)) {
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 403 });
  }

  let payload: GraphPayload;
  try {
    payload = JSON.parse(corpoCru) as GraphPayload;
  } catch {
    return NextResponse.json({ ok: true, ignoradas: 'corpo ilegível' });
  }

  const usuario = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!usuario) return NextResponse.json({ ok: true, ignoradas: 'sem usuário' });

  const allowlist = lerAllowlist(process.env.WHATSAPP_ALLOWED_NUMBERS);
  let registradas = 0;
  let recusadas = 0;
  let duplicadas = 0;

  for (const { msg, nome } of extrairMensagens(payload)) {
    const convertida = converter(msg, nome);
    if (!convertida) continue;

    // Numero de fora: descarta em silencio. Nao registra, nao responde,
    // nao conta para quem mandou o que aconteceu.
    if (!numeroAutorizado(convertida.fromNumber, allowlist)) {
      recusadas += 1;
      continue;
    }

    const r = await registrarMensagem(usuario.id, convertida);
    if (r.ok) {
      if (r.duplicada) duplicadas += 1;
      else registradas += 1;
    }
  }

  // So contagens. Nunca o texto da mensagem: o log da Vercel e mais um
  // lugar onde o conteudo do dono nao deve aparecer.
  return NextResponse.json({ ok: true, registradas, duplicadas, recusadas });
}
