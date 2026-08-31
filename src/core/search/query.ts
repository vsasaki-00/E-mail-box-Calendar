/**
 * Busca unificada. Ver docs/05-torre-de-controle.md (fase 3)
 *
 * Busca sobre METADADOS: assunto, remetente, snippet e titulo do evento.
 * O corpo fica de fora de proposito — indexar o corpo de tudo significaria
 * manter o corpo de tudo, e a decisao de privacidade do projeto e a oposta
 * ("corpo sob demanda").
 *
 * Funcoes puras aqui; a consulta ao banco fica em `run.ts`.
 */

export interface SearchFilters {
  /** Texto livre. */
  q: string;
  /** Restringir a uma conta. */
  connectionId?: string | null;
  /** So mensagens, so eventos, ou tudo. */
  kind?: 'MESSAGE' | 'EVENT' | null;
  /** So o que precisa de resposta. */
  needsReply?: boolean;
  /** So cobrancas. */
  cobranca?: boolean;
}

/** Menos que isso devolve a caixa inteira e nao ajuda ninguem. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Prepara o termo para `to_tsquery` do Postgres.
 *
 * Cada palavra vira um prefixo (`termo:*`), unidas por AND. Prefixo importa
 * porque quem busca "fornec" espera achar "fornecedor" — sem isso a busca
 * so acha palavra inteira, que na pratica e uma busca que quase nunca acha.
 *
 * Os caracteres especiais do tsquery sao removidos: deixa-los passar
 * transformaria uma busca por "R$ 100 & algo" em erro de sintaxe do
 * Postgres em vez de resultado.
 */
export function toTsQuery(termo: string): string | null {
  const palavras = termo
    .normalize('NFC')
    .split(/\s+/)
    .map((p) => p.replace(/[&|!():*'"\\<>@]/g, '').trim())
    .filter((p) => p.length > 0);

  if (palavras.length === 0) return null;
  return palavras.map((p) => `${p}:*`).join(' & ');
}

export interface SearchHit {
  unifiedItemId: string;
  kind: string;
  title: string;
  preview: string | null;
  occurredAt: Date;
  /** Em quantas caixas o mesmo item existe. */
  copyCount: number;
  connectionLabel: string;
  connectionColor: string;
  fromLabel: string | null;
  category: string | null;
  needsReply: boolean;
}

/**
 * A busca vale a pena rodar?
 *
 * Recusar termo curto evita o pior resultado possivel de uma busca: a
 * lista inteira, que parece resposta e nao e.
 */
export function isRunnable(filtros: SearchFilters): boolean {
  return filtros.q.trim().length >= MIN_QUERY_LENGTH;
}
