import type { RawEvent, RawMailbox, RawMessage } from './types';

/**
 * Traducao do dialeto do Google para o modelo canonico.
 *
 * Tudo aqui e funcao pura: sem rede, sem banco. E a parte do conector que mais
 * quebra na pratica (cabecalhos malformados, fusos, dia inteiro), entao e a que
 * mais precisa de teste.
 */

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

/**
 * Um no da arvore MIME. Recursivo: cada parte pode ter sub-partes (ex.:
 * multipart/alternative dentro de multipart/mixed com anexo).
 */
export interface GmailPart {
  filename?: string;
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

export interface GmailMessageResource {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
}

/** Labels do sistema viram papeis canonicos; o resto e pasta do usuario. */
export function labelRole(labelId: string): RawMailbox['role'] {
  switch (labelId) {
    case 'INBOX':
      return 'INBOX';
    case 'SENT':
      return 'SENT';
    case 'TRASH':
      return 'TRASH';
    case 'SPAM':
      return 'SPAM';
    default:
      return 'CUSTOM';
  }
}

function header(mensagem: GmailMessageResource, nome: string): string | undefined {
  const alvo = nome.toLowerCase();
  return mensagem.payload?.headers?.find((h) => h.name.toLowerCase() === alvo)?.value;
}

/**
 * Separa uma lista de enderecos respeitando virgulas dentro de aspas.
 * `"Silva, Joao" <joao@x.com>, ana@y.com` sao dois enderecos, nao tres.
 */
export function splitAddressList(valor?: string): string[] {
  if (!valor) return [];

  const partes: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (const caractere of valor) {
    if (caractere === '"') dentroDeAspas = !dentroDeAspas;
    if (caractere === ',' && !dentroDeAspas) {
      partes.push(atual);
      atual = '';
      continue;
    }
    atual += caractere;
  }
  partes.push(atual);

  return partes.map(extractEmail).filter((endereco): endereco is string => Boolean(endereco));
}

/** Extrai o endereco de `Nome <email@dominio>` ou de um endereco puro. */
export function extractEmail(valor?: string): string | undefined {
  if (!valor) return undefined;
  const comColchetes = valor.match(/<([^>]+)>/);
  const bruto = (comColchetes?.[1] ?? valor).trim().toLowerCase();
  return bruto.includes('@') ? bruto : undefined;
}

/** Extrai o nome de exibicao, removendo aspas. Sem nome, devolve undefined. */
export function extractDisplayName(valor?: string): string | undefined {
  if (!valor) return undefined;
  const posicao = valor.indexOf('<');
  if (posicao === -1) return undefined;
  const nome = valor.slice(0, posicao).trim().replace(/^"|"$/g, '').trim();
  return nome || undefined;
}

export function normalizeGmailMessage(mensagem: GmailMessageResource): RawMessage {
  const labels = mensagem.labelIds ?? [];
  const from = header(mensagem, 'From');

  return {
    providerId: mensagem.id,
    providerThreadId: mensagem.threadId,
    rfcMessageId: header(mensagem, 'Message-ID'),
    // A caixa canonica da copia: INBOX quando existir, senao o primeiro label
    // de sistema relevante. Os demais ficam em `labels`.
    mailboxProviderId: labels.includes('INBOX')
      ? 'INBOX'
      : (labels.find((l) => ['SENT', 'TRASH', 'SPAM', 'DRAFT'].includes(l)) ?? labels[0]),
    subject: header(mensagem, 'Subject'),
    snippet: mensagem.snippet,
    fromName: extractDisplayName(from),
    fromEmail: extractEmail(from),
    toEmails: splitAddressList(header(mensagem, 'To')),
    ccEmails: splitAddressList(header(mensagem, 'Cc')),
    // internalDate e o horario de recebimento no servidor, em ms. E mais
    // confiavel que o cabecalho Date, que o remetente controla.
    receivedAt: mensagem.internalDate
      ? new Date(Number(mensagem.internalDate))
      : new Date(header(mensagem, 'Date') ?? Date.now()),
    isRead: !labels.includes('UNREAD'),
    isFlagged: labels.includes('STARRED'),
    hasAttachments: (mensagem.payload?.parts ?? []).some(
      (parte) => typeof parte === 'object' && parte !== null && 'filename' in parte
        ? Boolean((parte as { filename?: string }).filename)
        : false,
    ),
    labels,
  };
}

/**
 * Cursor de paginacao do full sync de e-mail.
 *
 * Carrega o historyId capturado no inicio junto com o pageToken do Gmail: sem
 * isso, cada pagina recapturaria um historyId diferente e o incremental
 * comecaria do ponto errado.
 */
export interface MailPageState {
  listPageToken: string;
  historyId: string;
}

export function encodeMailPageToken(estado: MailPageState): string {
  return Buffer.from(JSON.stringify(estado), 'utf8').toString('base64url');
}

export function decodeMailPageToken(token?: string): MailPageState | undefined {
  if (!token) return undefined;
  try {
    const estado = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as MailPageState;
    return estado.listPageToken && estado.historyId ? estado : undefined;
  } catch {
    // Token corrompido: melhor recomecar o full sync do que estourar.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

export interface GoogleEventResource {
  id: string;
  iCalUID?: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  organizer?: { email?: string; self?: boolean };
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean }[];
}

const STATUS_MAP: Record<string, RawEvent['status']> = {
  confirmed: 'CONFIRMED',
  tentative: 'TENTATIVE',
  cancelled: 'CANCELLED',
};

const RESPONSE_MAP: Record<string, RawEvent['responseStatus']> = {
  needsAction: 'NEEDS_ACTION',
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentative: 'TENTATIVE',
};

/**
 * Converte o par start/end do Google.
 *
 * Eventos de dia inteiro vem como `date` (AAAA-MM-DD) e o `end` e EXCLUSIVO —
 * um evento de um dia termina no dia seguinte. Tratar isso como horario faria
 * todo evento de dia inteiro aparecer um dia a mais na agenda.
 */
export function parseEventWindow(evento: GoogleEventResource): {
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
} | null {
  const inicioData = evento.start?.date;
  const fimData = evento.end?.date;

  if (inicioData) {
    const startsAt = new Date(`${inicioData}T00:00:00`);
    const endsAt = fimData ? new Date(`${fimData}T00:00:00`) : new Date(startsAt);
    if (!fimData) endsAt.setDate(endsAt.getDate() + 1);
    return { startsAt, endsAt, isAllDay: true };
  }

  const inicio = evento.start?.dateTime;
  if (!inicio) return null;

  const startsAt = new Date(inicio);
  const endsAt = evento.end?.dateTime ? new Date(evento.end.dateTime) : new Date(startsAt);
  return { startsAt, endsAt, isAllDay: false };
}

function conferenceUrl(evento: GoogleEventResource): string | undefined {
  if (evento.hangoutLink) return evento.hangoutLink;
  return evento.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
}

export function normalizeGoogleEvent(
  evento: GoogleEventResource,
  calendarProviderId: string,
  accountEmail: string,
): RawEvent | null {
  const janela = parseEventWindow(evento);
  // Evento sem horario utilizavel nao entra na agenda; descartar e melhor que
  // inventar uma data e poluir a linha do dia.
  if (!janela) return null;

  const eu = evento.attendees?.find(
    (participante) =>
      participante.self === true ||
      participante.email?.toLowerCase() === accountEmail.toLowerCase(),
  );

  const souOrganizador =
    evento.organizer?.self === true ||
    evento.organizer?.email?.toLowerCase() === accountEmail.toLowerCase();

  return {
    providerId: evento.id,
    calendarProviderId,
    iCalUid: evento.iCalUID,
    recurringEventId: evento.recurringEventId,
    title: evento.summary,
    description: evento.description,
    location: evento.location,
    startsAt: janela.startsAt,
    endsAt: janela.endsAt,
    isAllDay: janela.isAllDay,
    timezone: evento.start?.timeZone,
    status: STATUS_MAP[evento.status ?? 'confirmed'] ?? 'CONFIRMED',
    // Organizador nao recebe convite: sem isso todo evento proprio apareceria
    // como "aguardando resposta" na Torre de Controle.
    responseStatus: souOrganizador
      ? 'ORGANIZER'
      : (RESPONSE_MAP[eu?.responseStatus ?? 'needsAction'] ?? 'NEEDS_ACTION'),
    organizerEmail: evento.organizer?.email,
    attendees: (evento.attendees ?? []).map((participante) => ({
      email: participante.email ?? '',
      name: participante.displayName,
      responseStatus: participante.responseStatus,
    })),
    conferenceUrl: conferenceUrl(evento),
  };
}

/**
 * Cursor de calendario: um syncToken por calendario, serializado em JSON.
 * Uma conta tem N calendarios e cada um tem seu proprio token.
 *
 * Reexportados por compatibilidade (nome usado nos testes existentes); a
 * implementacao e generica e compartilhada com o Microsoft Graph, em
 * ./container-cursor.
 */
export {
  parseContainerCursor as parseCalendarCursor,
  serializeContainerCursor as serializeCalendarCursor,
} from './container-cursor';
