import { createHash } from 'node:crypto';

/**
 * Deduplicacao entre contas. Ver ADR-4 em docs/01-arquitetura.md
 *
 * O mesmo e-mail chega em 3 caixas e o mesmo convite em 3 calendarios. Cada
 * copia continua existindo no banco (arquivar "o e-mail" precisa saber onde ele
 * fisicamente esta); a chave abaixo apenas agrupa as copias em um UnifiedItem.
 */

export interface MessageIdentity {
  /** Cabecalho Message-ID (RFC 5322). Preferencial: e globalmente unico. */
  rfcMessageId?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  receivedAt: Date;
}

export interface EventIdentity {
  /** iCalUID (RFC 5545). Preferencial: estavel entre provedores. */
  iCalUid?: string | null;
  title?: string | null;
  startsAt: Date;
  organizerEmail?: string | null;
}

/** Tolerancia do fallback: relogios e horarios de entrega diferem entre caixas. */
const TIME_BUCKET_MS = 60_000;

function hash(parts: (string | number)[]): string {
  return createHash('sha256').update(parts.join(' ')).digest('hex').slice(0, 32);
}

/**
 * Normaliza assunto para o fallback: remove prefixos de resposta/encaminhamento
 * (varios idiomas), colapsa espacos e caixa. "RE: Re: Fwd: Contrato" vira "contrato".
 */
export function normalizeSubject(subject?: string | null): string {
  if (!subject) return '';
  let current = subject;
  let previous: string;
  const prefix = /^\s*(re|res|fw|fwd|enc|encaminhada)\s*(\[\d+\])?\s*:\s*/i;
  do {
    previous = current;
    current = current.replace(prefix, '');
  } while (current !== previous);
  return current.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Endereco canonico: caixa baixa, sem nome de exibicao, sem espacos. */
export function normalizeEmail(email?: string | null): string {
  if (!email) return '';
  const match = email.match(/<([^>]+)>/);
  return (match?.[1] ?? email).trim().toLowerCase();
}

export function messageDedupeKey(identity: MessageIdentity): string {
  const rfcId = identity.rfcMessageId?.trim();
  if (rfcId) {
    // O Message-ID ja e globalmente unico; so tiramos os delimitadores.
    return `msg:rfc:${rfcId.replace(/^<|>$/g, '').toLowerCase()}`;
  }
  // Fallback: remetente + assunto normalizado + janela de tempo.
  const bucket = Math.round(identity.receivedAt.getTime() / TIME_BUCKET_MS);
  return `msg:h:${hash([
    normalizeEmail(identity.fromEmail),
    normalizeSubject(identity.subject),
    bucket,
  ])}`;
}

export function eventDedupeKey(identity: EventIdentity): string {
  const uid = identity.iCalUid?.trim();
  if (uid) {
    // A mesma serie recorrente compartilha o iCalUID; o inicio distingue as
    // ocorrencias, senao o dia todo colapsaria em um unico item.
    return `evt:ical:${uid.toLowerCase()}:${identity.startsAt.getTime()}`;
  }
  return `evt:h:${hash([
    normalizeSubject(identity.title),
    normalizeEmail(identity.organizerEmail),
    identity.startsAt.getTime(),
  ])}`;
}

/** Agrupa itens quaisquer pela chave de deduplicacao. */
export function groupByDedupeKey<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
