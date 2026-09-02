/**
 * HTML de e-mail preparado para ser MOSTRADO — nunca injetado na pagina.
 *
 * Duas camadas, porque nenhuma sozinha basta:
 *
 * 1. O iframe e `sandbox` (sem script) e o documento leva um CSP que so
 *    permite estilo inline e imagem `data:`. Imagem remota fica BLOQUEADA
 *    de proposito: pixel de rastreamento e como o remetente descobre que
 *    voce abriu — e uma newsletter que voce so quer classificar nao precisa
 *    saber disso.
 * 2. Mesmo assim, o HTML passa por uma limpeza: script, iframe, object,
 *    form e atributos `on*` saem. Se algum dia o sandbox for afrouxado por
 *    engano, a limpeza continua la.
 *
 * Nao e um sanitizador completo (isso e biblioteca inteira); e o minimo que
 * torna o pior caso chato em vez de perigoso, ATRAS do sandbox.
 */

const TAGS_PERIGOSAS = ['script', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'base'];

export function limparHtmlDeEmail(html: string): string {
  let limpo = html;

  for (const tag of TAGS_PERIGOSAS) {
    // Com conteudo e fechamento...
    limpo = limpo.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    // ...e auto-fechada ou sem fechamento.
    limpo = limpo.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }

  // Atributos de evento: onclick="...", onload='...', onerror=...
  limpo = limpo.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // javascript: em href/src.
  limpo = limpo.replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*/gi, '$1=$2#');

  return limpo;
}

/** O documento inteiro que vai no `srcdoc`. */
export function documentoParaIframe(html: string): string {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    'img-src data:',
    "font-src 'none'",
  ].join('; ');

  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<base target="_blank">' +
    '<style>body{font:14px/1.5 system-ui,sans-serif;margin:12px;color:#222;background:#fff;word-break:break-word}' +
    'img{max-width:100%}</style>' +
    `</head><body>${limparHtmlDeEmail(html)}</body></html>`
  );
}
