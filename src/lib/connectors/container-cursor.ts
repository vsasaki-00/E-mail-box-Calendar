/**
 * Cursor de sync com N containers (um calendario, uma pasta de e-mail...),
 * cada um com seu proprio token de incremental. Serializado como JSON no
 * campo unico `cursor` do SyncState.
 *
 * Usado pelo Google Calendar (um syncToken por calendario) e pelo Microsoft
 * Graph (um deltaLink por pasta de e-mail e por calendario).
 *
 * Alem dos containers, o JSON carrega uma chave reservada com a assinatura
 * da janela de calendario em vigor quando os tokens foram criados. Ver
 * `janela-calendario.ts`: a janela vive dentro do token do provedor, entao
 * so comparando essa assinatura da para saber que ela ficou velha.
 */

/** Chave reservada: nunca e um container. */
export const CHAVE_JANELA = '__janela';

export function parseContainerCursor(cursor?: string): Record<string, string> {
  if (!cursor) return {};
  try {
    const valor = JSON.parse(cursor) as unknown;
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return {};
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).filter(
        (entrada): entrada is [string, string] =>
          typeof entrada[1] === 'string' && entrada[0] !== CHAVE_JANELA,
      ),
    );
  } catch {
    // Cursor corrompido vira full sync, que e sempre seguro.
    return {};
  }
}

/**
 * Assinatura da janela gravada no cursor.
 *
 * `undefined` para cursor ausente, corrompido ou anterior a este campo — e
 * os tres querem a mesma coisa: refazer o full sync. Cursores de producao
 * criados antes desta mudanca caem aqui, que e exatamente o reparo
 * necessario para eles.
 */
export function lerJanelaDoCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const valor = JSON.parse(cursor) as unknown;
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return undefined;
    const janela = (valor as Record<string, unknown>)[CHAVE_JANELA];
    return typeof janela === 'string' ? janela : undefined;
  } catch {
    return undefined;
  }
}

export function serializeContainerCursor(
  tokens: Record<string, string>,
  janela?: string,
): string | undefined {
  // Sem nenhum container nao ha incremental a retomar: devolver so a janela
  // faria o motor achar que existe cursor e pular o full sync.
  if (Object.keys(tokens).length === 0) return undefined;
  return JSON.stringify(janela ? { ...tokens, [CHAVE_JANELA]: janela } : tokens);
}
