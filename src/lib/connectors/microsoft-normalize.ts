import type { RawEvent, RawMailbox, RawMessage } from './types';

/**
 * Traducao do dialeto do Microsoft Graph para o modelo canonico.
 *
 * Tudo aqui e funcao pura: sem rede, sem banco. Diferente do Gmail, o Graph
 * ja devolve campos estruturados (remetente, destinatarios, resposta do
 * usuario) em vez de cabecalhos crus — nao ha parsing de endereco aqui.
 */

// ---------------------------------------------------------------------------
// Pastas (mailFolders)
// ---------------------------------------------------------------------------

/**
 * Mapeia pelo NOME BEM-CONHECIDO da pasta (`wellKnownName`), nao pelo
 * `displayName`. O displayName e localizado ("Caixa de Entrada" em pt-BR,
 * "Posteingang" em de-DE); o alias bem-conhecido ("inbox", "sentitems") e
 * estavel em qualquer idioma da caixa.
 */
export function folderRole(wellKnownName: string): RawMailbox['role'] {
  switch (wellKnownName.toLowerCase()) {
    case 'inbox':
      return 'INBOX';
    case 'sentitems':
      return 'SENT';
    // `drafts` e `archive` estao em DEFAULT_SYNCED_FOLDER_ALIASES desde o
    // comeco, mas caiam no `default` e viravam CUSTOM — e o filtro de
    // `fetchMessages` descarta CUSTOM sem cursor. Resultado: as duas pastas
    // que o codigo dizia sincronizar nunca sincronizavam. A intencao estava
    // certa em dois lugares e errada no unico que decide.
    case 'drafts':
      return 'DRAFTS';
    case 'archive':
      return 'ARCHIVE';
    case 'deleteditems':
      return 'TRASH';
    case 'junkemail':
      return 'SPAM';
    default:
      return 'CUSTOM';
  }
}

/** Pastas sincronizadas por padrao no full sync. Lixeira e spam ficam fora. */
export const DEFAULT_SYNCED_FOLDER_ALIASES = ['inbox', 'sentitems', 'drafts', 'archive'] as const;

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessageResource {
  id: string;
  conversationId?: string;
  /** O cabecalho Message-ID (RFC 5322) ja vem pronto, sem parsing de header. */
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  hasAttachments?: boolean;
}

function enderecos(lista?: GraphRecipient[]): string[] {
  return (lista ?? [])
    .map((item) => item.emailAddress?.address?.trim().toLowerCase())
    .filter((endereco): endereco is string => Boolean(endereco));
}

export function normalizeGraphMessage(
  mensagem: GraphMessageResource,
  folderProviderId: string,
): RawMessage {
  return {
    providerId: mensagem.id,
    providerThreadId: mensagem.conversationId,
    rfcMessageId: mensagem.internetMessageId,
    mailboxProviderId: folderProviderId,
    subject: mensagem.subject,
    snippet: mensagem.bodyPreview,
    fromName: mensagem.from?.emailAddress?.name,
    fromEmail: mensagem.from?.emailAddress?.address?.trim().toLowerCase(),
    toEmails: enderecos(mensagem.toRecipients),
    ccEmails: enderecos(mensagem.ccRecipients),
    receivedAt: mensagem.receivedDateTime ? new Date(mensagem.receivedDateTime) : new Date(),
    isRead: Boolean(mensagem.isRead),
    isFlagged: mensagem.flag?.flagStatus === 'flagged',
    hasAttachments: Boolean(mensagem.hasAttachments),
    labels: [],
  };
}

// ---------------------------------------------------------------------------
// Eventos (calendarView)
// ---------------------------------------------------------------------------

export interface GraphEventResource {
  id: string;
  /** Nome do campo no Graph usa "UId" com U maiusculo, diferente do Google. */
  iCalUId?: string;
  seriesMasterId?: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: {
    emailAddress?: { name?: string; address?: string };
    status?: { response?: string };
  }[];
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  /** A resposta do PROPRIO usuario logado — o Graph ja resolve isso por nos. */
  responseStatus?: { response?: string };
}

/**
 * Converte um dateTime do Graph para UTC.
 *
 * Com o header `Prefer: outlook.timezone="UTC"` (enviado pelo conector), o
 * Graph devolve `dateTime` sem sufixo de fuso mas ja em UTC — sem esse
 * header, seria um horario local ambiguo no fuso indicado em `timeZone`, uma
 * fonte classica de bug de uma hora a mais/menos.
 */
function paraUtc(dateTime: string): Date {
  return new Date(dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`);
}

/**
 * Janela do evento. Para dia inteiro, o Graph tambem usa fim exclusivo (um
 * evento de 1 dia termina a meia-noite do dia seguinte), igual ao Google.
 */
export function parseGraphEventWindow(
  evento: GraphEventResource,
): { startsAt: Date; endsAt: Date } | null {
  if (!evento.start?.dateTime) return null;
  const startsAt = paraUtc(evento.start.dateTime);
  const endsAt = evento.end?.dateTime ? paraUtc(evento.end.dateTime) : new Date(startsAt);
  return { startsAt, endsAt };
}

const RESPONSE_MAP: Record<string, RawEvent['responseStatus']> = {
  organizer: 'ORGANIZER',
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentativelyaccepted: 'TENTATIVE',
};

function conferenceUrl(evento: GraphEventResource): string | undefined {
  return evento.onlineMeeting?.joinUrl ?? evento.onlineMeetingUrl;
}

export function normalizeGraphEvent(
  evento: GraphEventResource,
  calendarProviderId: string,
): RawEvent | null {
  const janela = parseGraphEventWindow(evento);
  // Evento sem horario utilizavel nao entra na agenda; descartar e melhor que
  // inventar uma data e poluir a linha do dia.
  if (!janela) return null;

  return {
    providerId: evento.id,
    calendarProviderId,
    iCalUid: evento.iCalUId,
    recurringEventId: evento.seriesMasterId,
    title: evento.subject,
    description: evento.bodyPreview,
    location: evento.location?.displayName,
    startsAt: janela.startsAt,
    endsAt: janela.endsAt,
    isAllDay: Boolean(evento.isAllDay),
    // Graph nao devolve o modelo TENTATIVE em nivel de evento como o Google;
    // so distingue confirmado de cancelado.
    status: evento.isCancelled ? 'CANCELLED' : 'CONFIRMED',
    // O Graph ja resolve a resposta do usuario logado — sem precisar
    // procurar "self" na lista de participantes como no Google.
    responseStatus: RESPONSE_MAP[evento.responseStatus?.response?.toLowerCase() ?? ''] ?? 'NEEDS_ACTION',
    organizerEmail: evento.organizer?.emailAddress?.address,
    attendees: (evento.attendees ?? []).map((participante) => ({
      email: participante.emailAddress?.address ?? '',
      name: participante.emailAddress?.name,
      responseStatus: participante.status?.response,
    })),
    conferenceUrl: conferenceUrl(evento),
  };
}
