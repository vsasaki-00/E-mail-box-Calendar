import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MensagemRecebida } from './entrada';
import { normalizarNumero } from './seguranca';

/**
 * Adaptador do Twilio. Ver docs/11-whatsapp.md
 *
 * O Twilio é BSP homologado pela Meta — caminho oficial, não bridge. O que
 * muda em relação à Cloud API é só a casca: `application/x-www-form-
 * urlencoded` em vez de JSON, assinatura HMAC-SHA1 em vez de SHA256, e
 * nenhum handshake de verificação. O núcleo (interpretar a frase, propor,
 * confirmar) não sabe de nada disso.
 */

/**
 * Assinatura do Twilio: HMAC-SHA1 de (URL + parâmetros ordenados), base64.
 *
 * A concatenação é `chave1valor1chave2valor2...`, com as chaves em ordem
 * alfabética e SEM separador nenhum. E a URL precisa ser exatamente a que o
 * Twilio chamou — é o detalhe que mais quebra em produção, porque atrás de
 * um proxy a URL que o runtime enxerga é a interna.
 */
export function assinaturaTwilioConfere(
  url: string,
  params: Record<string, string>,
  cabecalho: string | null,
  authToken: string,
): boolean {
  if (!cabecalho || !authToken) return false;

  const base = Object.keys(params)
    .sort()
    .reduce((acc, chave) => acc + chave + params[chave], url);

  const esperada = createHmac('sha1', authToken).update(Buffer.from(base, 'utf8')).digest('base64');

  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(cabecalho, 'utf8');
  // Comprimentos diferentes já reprovam, e comparar antes evita o throw do
  // timingSafeEqual — que exige buffers do mesmo tamanho.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * A URL pública desta rota, como o Twilio a chamou.
 *
 * Na Vercel, `request.url` traz o host interno da função; assinar contra ele
 * nunca bate. `WHATSAPP_PUBLIC_URL` manda quando existe; senão, reconstrói
 * a partir dos cabeçalhos do proxy — que é o que a plataforma preenche.
 */
export function urlPublica(
  request: { url: string; headers: { get(nome: string): string | null } },
  caminho = '/api/whatsapp/twilio',
): string {
  const configurada = process.env.WHATSAPP_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (configurada) return `${configurada}${caminho}`;

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}${caminho}`;

  return request.url.split('?')[0]!;
}

/** Tipo declarado pelo Twilio para uma mídia, traduzido para o nosso. */
function tipoDeMidia(contentType: string | undefined): string {
  if (!contentType) return 'DOCUMENT';
  if (contentType.startsWith('image/')) return 'IMAGE';
  if (contentType.startsWith('audio/')) return 'AUDIO';
  if (contentType.startsWith('video/')) return 'VIDEO';
  return 'DOCUMENT';
}

/**
 * Form do Twilio → nossa mensagem.
 *
 * `From` vem como `whatsapp:+5511987654321`; sem tirar o prefixo, a
 * allowlist nunca casaria. Mídia fica por referência (`MediaUrl0`), como na
 * Cloud API — o binário continua no provedor.
 */
export function converterTwilio(params: Record<string, string>, agora = new Date()): MensagemRecebida | undefined {
  const sid = params.MessageSid ?? params.SmsMessageSid;
  const de = params.From;
  if (!sid || !de) return undefined;

  const quantidade = Number(params.NumMedia ?? '0');
  const temMidia = Number.isFinite(quantidade) && quantidade > 0;
  const contentType = params.MediaContentType0;
  const corpo = params.Body?.trim();

  return {
    externalId: sid,
    // `whatsapp:+55...` → `55...`
    fromNumber: normalizarNumero(de.replace(/^whatsapp:/i, '')),
    fromName: params.ProfileName || undefined,
    kind: temMidia ? tipoDeMidia(contentType) : 'TEXT',
    text: corpo || undefined,
    mediaId: temMidia ? params.MediaUrl0 : undefined,
    mediaMimeType: temMidia ? contentType : undefined,
    // O Twilio não manda nome de arquivo; o tipo é o que dá para mostrar.
    mediaFileName: undefined,
    // O Twilio não datou a mensagem no corpo do webhook: a chegada é o que
    // temos, e é honesto — a diferença é de segundos.
    receivedAt: agora,
  };
}
