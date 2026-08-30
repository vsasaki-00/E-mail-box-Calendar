/**
 * Cursor de sync com N containers (um calendario, uma pasta de e-mail...),
 * cada um com seu proprio token de incremental. Serializado como JSON no
 * campo unico `cursor` do SyncState.
 *
 * Usado pelo Google Calendar (um syncToken por calendario) e pelo Microsoft
 * Graph (um deltaLink por pasta de e-mail e por calendario).
 */

export function parseContainerCursor(cursor?: string): Record<string, string> {
  if (!cursor) return {};
  try {
    const valor = JSON.parse(cursor) as unknown;
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return {};
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).filter(
        (entrada): entrada is [string, string] => typeof entrada[1] === 'string',
      ),
    );
  } catch {
    // Cursor corrompido vira full sync, que e sempre seguro.
    return {};
  }
}

export function serializeContainerCursor(tokens: Record<string, string>): string | undefined {
  return Object.keys(tokens).length > 0 ? JSON.stringify(tokens) : undefined;
}
