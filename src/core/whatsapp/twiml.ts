/**
 * A resposta que o Twilio aceita. Ver docs/11-whatsapp.md
 *
 * O Twilio não lê JSON na resposta de um webhook de mensagem: ele espera
 * **TwiML**, e devolve o erro 12300 ("Invalid Content-Type: application/json
 * supplied") para qualquer outra coisa. A mensagem entra no app do mesmo
 * jeito — mas cada uma vira um alarme no console, e um canal que grita a
 * cada mensagem é um canal que ninguém olha.
 *
 * Um `<Response>` vazio significa exatamente o que queremos dizer: recebi,
 * e não tenho nada a responder. O Meridiano nunca manda mensagem de volta.
 *
 * A nota vai num COMENTÁRIO XML dentro do Response. Comentário é ignorado
 * por qualquer parser de TwiML, e aparece inteiro no inspetor de requisição
 * do Twilio — que é o único lugar onde dá para ver o que aconteceu com uma
 * mensagem recusada, já que recusa não deixa registro no banco de
 * propósito.
 */

/**
 * Deixa o texto seguro dentro de um comentário XML.
 *
 * `--` fecha comentário antes da hora e um `-` no fim gera `--->`, que é XML
 * inválido. Nenhuma das duas coisas pode escapar daqui: um comentário
 * quebrado transformaria a resposta em erro de parse — trocando um alarme
 * do Twilio por outro.
 */
function seguroEmComentario(texto: string): string {
  return texto
    .replace(/-{2,}/g, '-')
    .replace(/[<>&]/g, ' ')
    .replace(/\s+/g, ' ')
    // Cortar ANTES de tirar o traço final: cortar depois poderia deixar um
    // `-` na ponta de novo, e `--->` é XML inválido.
    .slice(0, 200)
    .replace(/-+$/, '')
    .trim();
}

export function twimlVazio(nota?: string): string {
  const limpa = nota ? seguroEmComentario(nota) : '';
  const comentario = limpa ? `<!-- ${limpa} -->` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${comentario}</Response>`;
}

/** Cabeçalhos de uma resposta TwiML. `no-store`: nada aqui é cacheável. */
export const CABECALHOS_TWIML = {
  'content-type': 'text/xml; charset=utf-8',
  'cache-control': 'no-store',
} as const;
