/**
 * Baixar a mídia que chegou por WhatsApp. Ver docs/11-whatsapp.md
 *
 * Buscar uma URL que veio dentro de um webhook é a definição de SSRF, então
 * três travas, todas necessárias:
 *
 *  1. **Só host do Twilio.** A assinatura já prova que a entrega é dele, mas
 *     assinatura não prova para onde a URL aponta — e um parâmetro é só
 *     texto. Sem esta trava, quem controlasse o conteúdo do webhook faria o
 *     servidor buscar qualquer endereço interno.
 *  2. **Redirecionamento na mão.** A URL do Twilio responde 30x para um CDN.
 *     Seguir automático mandaria o cabeçalho `Authorization` — o Auth Token
 *     da conta — para o destino do redirecionamento. A segunda busca vai
 *     SEM credencial nenhuma.
 *  3. **Teto de bytes e de tempo.** Isto roda dentro do webhook, que tem 30s
 *     para responder. Um arquivo grande demais não pode virar timeout, que
 *     faria o Twilio reentregar a mensagem inteira.
 */

/** Hosts do PRIMEIRO pedido. A URL vem do webhook, então aqui é fechado. */
const HOSTS_PERMITIDOS = new Set(['api.twilio.com', 'media.twiliocdn.com']);

/**
 * Endereços que nunca podem ser o destino de um redirecionamento.
 *
 * O primeiro pedido é travado por allowlist porque a URL vem do corpo do
 * webhook. O DESTINO do redirecionamento é outra coisa: quem o escolhe é o
 * Twilio, numa resposta que só existe porque a assinatura conferiu — e ele
 * aponta para o S3, que muda de host por região. Uma allowlist ali quebra
 * sozinha (foi o que aconteceu: "Redirecionamento para fora do Twilio" num
 * PDF legítimo).
 *
 * Então o destino aceita host público qualquer, e o que fica barrado é o
 * que um redirecionamento jamais deveria alcançar: a própria máquina e as
 * redes internas.
 */
const INTERNO =
  /^(localhost|.*\.localhost|127\..*|0\..*|10\..*|192\.168\..*|172\.(1[6-9]|2\d|3[01])\..*|169\.254\..*|\[?::1\]?|\[?f[cd].*)$/i;

/** 8 MB. O WhatsApp já limita bem abaixo disso; isto é o cinto. */
export const LIMITE_BYTES = 8 * 1024 * 1024;

/** Tempo total de download. O webhook inteiro tem 30s. */
export const LIMITE_MS = 12_000;

/**
 * A URL é do Twilio e é https?
 *
 * Pura e testada de propósito: é a única coisa entre um parâmetro de
 * webhook e uma requisição saindo do servidor.
 */
export function urlDeMidiaPermitida(bruta: string): boolean {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return HOSTS_PERMITIDOS.has(url.hostname.toLowerCase());
}

/**
 * O destino do redirecionamento serve?
 *
 * Https e fora das redes internas. Menos fechado que o primeiro salto, e de
 * propósito: este endereço foi escolhido pelo Twilio, não por quem mandou a
 * mensagem. O que continua valendo é que nenhuma credencial viaja para cá.
 */
export function destinoDeRedirecionamentoPermitido(bruta: string): boolean {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return !INTERNO.test(url.hostname.toLowerCase());
}

export type ResultadoMidia =
  | { ok: true; bytes: Uint8Array; contentType?: string }
  | { ok: false; erro: string };

/** Lê o corpo com teto, para um arquivo enorme não virar memória enorme. */
async function lerComTeto(resposta: Response, limite: number): Promise<Uint8Array | undefined> {
  const declarado = Number(resposta.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > limite) return undefined;

  const reader = resposta.body?.getReader();
  if (!reader) return undefined;

  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    // O content-length pode mentir ou faltar; o teto real é medido aqui.
    if (total > limite) {
      await reader.cancel();
      return undefined;
    }
    pedacos.push(value);
  }

  const saida = new Uint8Array(total);
  let offset = 0;
  for (const p of pedacos) {
    saida.set(p, offset);
    offset += p.byteLength;
  }
  return saida;
}

export async function baixarMidiaTwilio(
  url: string,
  credenciais: { accountSid?: string; authToken?: string },
  limites: { bytes?: number; ms?: number } = {},
): Promise<ResultadoMidia> {
  if (!urlDeMidiaPermitida(url)) return { ok: false, erro: 'URL de mídia fora do Twilio' };
  if (!credenciais.accountSid || !credenciais.authToken) {
    return { ok: false, erro: 'TWILIO_ACCOUNT_SID não configurado' };
  }

  const teto = limites.bytes ?? LIMITE_BYTES;
  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), limites.ms ?? LIMITE_MS);

  try {
    const auth = Buffer.from(`${credenciais.accountSid}:${credenciais.authToken}`).toString('base64');
    // `manual`: o Authorization NÃO pode viajar para o destino do
    // redirecionamento — ele é o Auth Token da conta.
    const primeira = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      redirect: 'manual',
      signal: controle.signal,
    });

    let resposta = primeira;
    if (primeira.status >= 300 && primeira.status < 400) {
      const destino = primeira.headers.get('location');
      if (!destino) return { ok: false, erro: 'Redirecionamento sem destino' };
      const absoluto = new URL(destino, url).toString();
      if (!destinoDeRedirecionamentoPermitido(absoluto)) {
        return { ok: false, erro: 'Redirecionamento para endereço não permitido' };
      }
      // Sem credencial: o link já é assinado pelo próprio Twilio.
      resposta = await fetch(absoluto, { signal: controle.signal });
    }

    if (!resposta.ok) return { ok: false, erro: `Twilio respondeu ${resposta.status}` };

    const bytes = await lerComTeto(resposta, teto);
    if (!bytes) return { ok: false, erro: `Arquivo maior que ${Math.round(teto / 1024 / 1024)}MB` };

    return { ok: true, bytes, contentType: resposta.headers.get('content-type') ?? undefined };
  } catch (erro) {
    const abortado = erro instanceof Error && erro.name === 'AbortError';
    return { ok: false, erro: abortado ? 'Download demorou demais' : 'Não consegui baixar o arquivo' };
  } finally {
    clearTimeout(alarme);
  }
}
