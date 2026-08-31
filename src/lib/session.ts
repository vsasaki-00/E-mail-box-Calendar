/**
 * Sessão assinada. Ver docs/09-deploy.md
 *
 * Este módulo roda no **Edge** (o middleware do Next), então usa apenas
 * Web Crypto — `node:crypto` não existe lá. Por isso ele está separado de
 * `senha.ts`, que usa scrypt e só roda no Node.
 *
 * O cookie carrega `expiraEm` e uma assinatura HMAC. Não há estado no
 * servidor: a validade é verificável só com o segredo, o que funciona em
 * ambiente serverless onde não há memória compartilhada entre requisições.
 */

/** Nome do cookie. */
export const COOKIE_SESSAO = 'meridiano_sessao';

/** Quanto tempo a sessão dura. Renovada a cada login, não deslizante. */
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000;

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * `Uint8Array<ArrayBuffer>` e não `Uint8Array` puro: o padrão do TypeScript
 * inclui `SharedArrayBuffer`, que a Web Crypto não aceita. Dizer o tipo
 * exato aqui evita um cast em cada chamada.
 */
function deBase64url(texto: string): Uint8Array<ArrayBuffer> {
  const bin = atob(texto.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function chaveHmac(segredo: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Gera o token da sessão: `<payload>.<assinatura>`.
 *
 * O payload não é segredo (só diz até quando vale); a assinatura é que
 * impede alguém de forjar ou estender a validade.
 */
export async function assinarSessao(segredo: string, agora = Date.now()): Promise<string> {
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ exp: agora + DURACAO_SESSAO_MS })),
  );
  const assinatura = await crypto.subtle.sign(
    'HMAC',
    await chaveHmac(segredo),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64url(new Uint8Array(assinatura))}`;
}

/**
 * Verifica o token. Devolve `false` para qualquer coisa fora do esperado —
 * assinatura errada, formato quebrado, ou prazo vencido.
 *
 * `crypto.subtle.verify` já compara em tempo constante, então não há como
 * descobrir a assinatura correta medindo o tempo de resposta.
 */
export async function verificarSessao(
  segredo: string,
  token: string | undefined,
  agora = Date.now(),
): Promise<boolean> {
  if (!token) return false;

  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return false;

  let confere = false;
  try {
    confere = await crypto.subtle.verify(
      'HMAC',
      await chaveHmac(segredo),
      deBase64url(assinatura),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
  if (!confere) return false;

  try {
    const dados = JSON.parse(new TextDecoder().decode(deBase64url(payload))) as { exp?: number };
    return typeof dados.exp === 'number' && dados.exp > agora;
  } catch {
    return false;
  }
}
