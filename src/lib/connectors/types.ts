import type { Provider } from '@prisma/client';

/**
 * Contrato unico de conector. Ver docs/03-conectores.md
 *
 * O nucleo NUNCA ramifica por provedor. Cada conector declara o que sabe fazer
 * em `capabilities` e o motor de sync consulta essa declaracao para decidir a
 * estrategia (push vs polling, delta vs full, busca local vs no servidor).
 */

/** Como o provedor entrega mudancas desde o ultimo sync. */
export type IncrementalStrategy =
  | 'history-api' // Gmail: users.history.list a partir de um historyId
  | 'delta-token' // Microsoft Graph: deltaLink
  | 'sync-token' // Google Calendar: syncToken
  | 'etag-poll' // CalDAV/IMAP: comparacao de ctag/ETag
  | 'none'; // sem incremental: sempre full sync da janela

export interface ConnectorCapabilities {
  mail: boolean;
  calendar: boolean;
  contacts: boolean;
  incrementalSync: IncrementalStrategy;
  /** Webhook/subscription nativo. Quando false, o agendador usa polling. */
  push: boolean;
  /** Busca no servidor. Quando false, buscamos no cache local do Postgres. */
  serverSideSearch: boolean;
  /** Fase 4. Na fase 1 todos os conectores sao somente leitura. */
  write: boolean;
  /**
   * Sabe baixar anexo? O painel financeiro usa para ler boleto em PDF.
   *
   * Declarado em vez de assumido: o nucleo consulta a capacidade e
   * simplesmente nao tenta onde ela e falsa, sem ramificar por provedor.
   */
  attachments: boolean;
  /** Intervalo sugerido de polling, em segundos. */
  pollIntervalSeconds: number;
}

/**
 * Conjunto fechado de erros. Traduzir a falha do provedor para um destes e
 * responsabilidade do conector; reagir a eles e responsabilidade do motor.
 */
export type ConnectorErrorCode =
  | 'AUTH_EXPIRED'
  | 'CURSOR_EXPIRED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'TRANSIENT'
  | 'PERMANENT';

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
    /** Segundos a esperar antes de tentar de novo (vem do Retry-After). */
    readonly retryAfterSeconds?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

// --- Modelos que o conector devolve (ainda por conexao, ja normalizados) ---

export interface RawMailbox {
  providerId: string;
  name: string;
  role: 'INBOX' | 'SENT' | 'ARCHIVE' | 'SPAM' | 'TRASH' | 'CUSTOM';
  unreadCount?: number;
  totalCount?: number;
}

export interface RawCalendar {
  providerId: string;
  name: string;
  timezone?: string;
  color?: string;
  isPrimary: boolean;
  isReadOnly: boolean;
}

export interface RawMessage {
  providerId: string;
  providerThreadId?: string;
  /** Cabecalho Message-ID (RFC 5322): chave preferencial de deduplicacao. */
  rfcMessageId?: string;
  mailboxProviderId?: string;
  subject?: string;
  snippet?: string;
  fromName?: string;
  fromEmail?: string;
  toEmails: string[];
  ccEmails: string[];
  receivedAt: Date;
  isRead: boolean;
  isFlagged: boolean;
  hasAttachments: boolean;
  labels: string[];
}

export interface RawEvent {
  providerId: string;
  calendarProviderId: string;
  /** iCalUID (RFC 5545): estavel entre provedores, chave de deduplicacao. */
  iCalUid?: string;
  recurringEventId?: string;
  title?: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
  timezone?: string;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  responseStatus: 'NEEDS_ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'ORGANIZER';
  organizerEmail?: string;
  attendees: { email: string; name?: string; responseStatus?: string }[];
  conferenceUrl?: string;
}

/**
 * Uma pagina de resultados. `cursor` e opaco para o nucleo — cada provedor
 * guarda ali o que precisar (historyId, deltaLink, syncToken, ctag).
 */
export interface Page<T> {
  items: T[];
  /** Ids removidos no provedor desde o ultimo sync (so no modo incremental). */
  deletedProviderIds?: string[];
  /** Passe de volta em `fetchX` para pegar a proxima pagina. */
  nextPageToken?: string;
  /** Cursor a persistir quando `nextPageToken` for undefined (fim do sync). */
  cursor?: string;
}

export interface SyncWindow {
  since: Date;
  until: Date;
}

export interface FetchOptions {
  /** Cursor persistido. Ausente = full sync. */
  cursor?: string;
  pageToken?: string;
  window?: SyncWindow;
  pageSize?: number;
}

/** Credenciais ja decifradas. Nunca logar, nunca serializar. */
export interface ConnectorCredentials {
  accessToken?: string;
  refreshToken?: string;
  username?: string;
  password?: string;
  expiresAt?: Date;
}

export interface ConnectorContext {
  connectionId: string;
  accountEmail: string;
  credentials: ConnectorCredentials;
  /** Config nao sensivel: host/porta IMAP, urls CalDAV, tenant. */
  config: Record<string, unknown>;
  /** Chamado quando o conector renova o token; o motor persiste cifrado. */
  onCredentialsRefreshed?: (credentials: ConnectorCredentials) => Promise<void>;
}

export interface Connector {
  readonly provider: Provider;
  readonly capabilities: ConnectorCapabilities;

  /** Valida credenciais e devolve o endereco canonico da conta. */
  verify(ctx: ConnectorContext): Promise<{ accountEmail: string }>;

  listMailboxes(ctx: ConnectorContext): Promise<RawMailbox[]>;
  listCalendars(ctx: ConnectorContext): Promise<RawCalendar[]>;

  fetchMessages(ctx: ConnectorContext, options: FetchOptions): Promise<Page<RawMessage>>;
  fetchEvents(ctx: ConnectorContext, options: FetchOptions): Promise<Page<RawEvent>>;

  /** Corpo sob demanda: nao vem no sync de lista, por custo de quota e banco. */
  fetchMessageBody(
    ctx: ConnectorContext,
    providerId: string,
  ): Promise<{ text?: string; html?: string }>;

  /**
   * Anexos sob demanda. So existe quando `capabilities.attachments`.
   *
   * Sob demanda pelo mesmo motivo do corpo, e com um agravante: anexo pesa
   * megabytes. Baixar tudo que chega encheria o banco e a quota sem que
   * quase nada disso fosse olhado.
   */
  fetchAttachments?(
    ctx: ConnectorContext,
    providerId: string,
    options?: { maxBytes?: number },
  ): Promise<RawAttachment[]>;
}

/** Um anexo ja baixado. `data` e o conteudo bruto. */
export interface RawAttachment {
  providerId: string;
  filename: string;
  mimeType: string;
  size: number;
  data: Uint8Array;
}

/** Capacidades de um conector somente leitura sem push (o caso mais restrito). */
export const READ_ONLY_DEFAULTS: Pick<ConnectorCapabilities, 'write' | 'push' | 'serverSideSearch'> =
  {
    write: false,
    push: false,
    serverSideSearch: false,
  };
