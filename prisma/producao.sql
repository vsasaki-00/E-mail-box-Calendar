-- ---------------------------------------------------------------------------
-- Bootstrap do banco de producao (Supabase) — rodar UMA vez, em banco vazio.
--
-- Uso: Supabase -> SQL Editor -> New query -> colar este arquivo inteiro
-- -> Run. Equivale ao `pnpm db:push` do passo 3 de docs/09-deploy.md, sem
-- precisar de terminal nem de connection string.
--
-- Gerado de prisma/schema.prisma com:
--   npx prisma migrate diff --from-empty --to-schema-datamodel \
--     prisma/schema.prisma --script
--
-- Validado assim: aplicado num Postgres 16 limpo e, em seguida,
-- `prisma db push` contra o mesmo banco respondeu "The database is already
-- in sync with the Prisma schema" — 22 tabelas (fase 7B incluida).
--
-- Se o schema.prisma mudar depois, NAO edite este arquivo: regenere com o
-- comando acima, ou rode `pnpm db:push` que aplica so a diferenca.
-- ---------------------------------------------------------------------------

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GOOGLE', 'MICROSOFT', 'APPLE', 'IMAP_CALDAV');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'REAUTH_REQUIRED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncResource" AS ENUM ('MAIL', 'CALENDAR', 'CONTACTS');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'RUNNING', 'BACKOFF', 'CURSOR_EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncRunOutcome" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "UnifiedKind" AS ENUM ('MESSAGE', 'EVENT');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResponseStatus" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE', 'ORGANIZER');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TriageCategory" AS ENUM ('COBRANCA', 'NEEDS_REPLY', 'INFORMATIVE', 'PROMOTIONAL', 'SPAM', 'DISPOSABLE');

-- CreateEnum
CREATE TYPE "TriagePriority" AS ENUM ('URGENT', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "TriageSource" AS ENUM ('RULE', 'MODEL', 'USER');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('ARCHIVE', 'UNARCHIVE', 'MARK_READ', 'MARK_UNREAD', 'ADD_LABEL', 'REMOVE_LABEL', 'EVENT_ACCEPT', 'EVENT_DECLINE', 'EVENT_TENTATIVE', 'EVENT_CREATE', 'EVENT_MOVE', 'SEND_REPLY');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DONE', 'FAILED', 'UNDONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActionActor" AS ENUM ('USER', 'AGENT');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PROPOSED', 'EDITED', 'APPROVED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "BillKind" AS ENUM ('BOLETO', 'PIX', 'FATURA', 'ASSINATURA', 'NOTA_FISCAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "BillSource" AS ENUM ('INSTRUMENT', 'TEXT', 'MODEL', 'USER');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('PENDING', 'PAID', 'IGNORED');

-- CreateEnum
CREATE TYPE "TriageCalibration" AS ENUM ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "FinancialAccountKind" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'CASH', 'INVESTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('OFX', 'CSV', 'MANUAL');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('NONE', 'SUGGESTED', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "displayName" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "capabilities" JSONB NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretCiphertext" TEXT,
    "secretIv" TEXT,
    "secretTag" TEXT,
    "secretKeyId" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "writeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "grantedScopes" JSONB NOT NULL DEFAULT '[]',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CUSTOM',
    "includeInUnified" BOOLEAN NOT NULL DEFAULT false,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarSource" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT,
    "color" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT true,
    "includeInUnified" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CalendarSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "providerId" TEXT NOT NULL,
    "providerThreadId" TEXT,
    "rfcMessageId" TEXT,
    "subject" TEXT,
    "snippet" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "toEmails" JSONB NOT NULL DEFAULT '[]',
    "ccEmails" JSONB NOT NULL DEFAULT '[]',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "labels" JSONB NOT NULL DEFAULT '[]',
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "bodyFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unifiedItemId" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "calendarSourceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "iCalUid" TEXT,
    "recurringEventId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "responseStatus" "ResponseStatus" NOT NULL DEFAULT 'NEEDS_ACTION',
    "organizerEmail" TEXT,
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "conferenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unifiedItemId" TEXT,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnifiedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "UnifiedKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT,
    "preview" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "copyCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnifiedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "redirectAfter" TEXT,
    "requestWrite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "resource" "SyncResource" NOT NULL,
    "cursor" TEXT,
    "pageToken" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "lastFullSyncAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "resource" "SyncResource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" "SyncRunOutcome",
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "itemsDeleted" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "condition" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARN',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxProfile" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "businessName" TEXT,
    "role" TEXT,
    "objective" TEXT,
    "calibration" "TriageCalibration" NOT NULL DEFAULT 'BALANCED',
    "vipSenders" JSONB NOT NULL DEFAULT '[]',
    "urgentKeywords" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "greetings" JSONB NOT NULL DEFAULT '[]',
    "closings" JSONB NOT NULL DEFAULT '[]',
    "signature" TEXT,
    "avgWordCount" INTEGER NOT NULL DEFAULT 0,
    "medianWordCount" INTEGER NOT NULL DEFAULT 0,
    "formality" TEXT,
    "language" TEXT,
    "traits" JSONB NOT NULL DEFAULT '[]',
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "derivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userApproved" BOOLEAN NOT NULL DEFAULT false,
    "userNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTriage" (
    "id" TEXT NOT NULL,
    "unifiedItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "TriageCategory" NOT NULL,
    "priority" "TriagePriority" NOT NULL,
    "needsReply" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "source" "TriageSource" NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemTriage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillExtraction" (
    "id" TEXT NOT NULL,
    "unifiedItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "dueDate" TIMESTAMP(3),
    "payee" TEXT,
    "kind" "BillKind" NOT NULL DEFAULT 'OUTRO',
    "digitableLine" TEXT,
    "pixPayload" TEXT,
    "pixKey" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" "BillSource" NOT NULL,
    "reason" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "isPayable" BOOLEAN NOT NULL DEFAULT true,
    "status" "BillStatus" NOT NULL DEFAULT 'PENDING',
    "userNotes" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "unifiedItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT,
    "bodyGenerated" TEXT NOT NULL,
    "bodyComposed" TEXT NOT NULL,
    "bodyEdited" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'PROPOSED',
    "voiceProfileDerivedAt" TIMESTAMP(3),
    "reason" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" "ActionKind" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "actor" "ActionActor" NOT NULL DEFAULT 'USER',
    "unifiedItemId" TEXT,
    "providerId" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "previousState" JSONB,
    "reversible" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL,
    "error" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageFeedback" (
    "id" TEXT NOT NULL,
    "itemTriageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromCategory" "TriageCategory",
    "toCategory" "TriageCategory",
    "fromPriority" "TriagePriority",
    "toPriority" "TriagePriority",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "institution" TEXT,
    "kind" "FinancialAccountKind" NOT NULL DEFAULT 'CHECKING',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "business" TEXT,
    "bankId" TEXT,
    "accountId" TEXT,
    "balanceCents" INTEGER,
    "balanceAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "fileName" TEXT,
    "fileHash" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "entriesFound" INTEGER NOT NULL DEFAULT 0,
    "entriesCreated" INTEGER NOT NULL DEFAULT 0,
    "entriesDuplicate" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "statementId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "description" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "fitId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "business" TEXT,
    "category" TEXT,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'NONE',
    "matchedBillId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "matchReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Connection_userId_status_idx" ON "Connection"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_userId_provider_accountEmail_key" ON "Connection"("userId", "provider", "accountEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_connectionId_providerId_key" ON "Mailbox"("connectionId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarSource_connectionId_providerId_key" ON "CalendarSource"("connectionId", "providerId");

-- CreateIndex
CREATE INDEX "Message_connectionId_receivedAt_idx" ON "Message"("connectionId", "receivedAt");

-- CreateIndex
CREATE INDEX "Message_rfcMessageId_idx" ON "Message"("rfcMessageId");

-- CreateIndex
CREATE INDEX "Message_unifiedItemId_idx" ON "Message"("unifiedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_connectionId_providerId_key" ON "Message"("connectionId", "providerId");

-- CreateIndex
CREATE INDEX "CalendarEvent_connectionId_startsAt_idx" ON "CalendarEvent"("connectionId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_iCalUid_idx" ON "CalendarEvent"("iCalUid");

-- CreateIndex
CREATE INDEX "CalendarEvent_unifiedItemId_idx" ON "CalendarEvent"("unifiedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_connectionId_providerId_key" ON "CalendarEvent"("connectionId", "providerId");

-- CreateIndex
CREATE INDEX "UnifiedItem_userId_kind_occurredAt_idx" ON "UnifiedItem"("userId", "kind", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnifiedItem_userId_dedupeKey_key" ON "UnifiedItem"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "SyncState_nextRunAt_idx" ON "SyncState"("nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_connectionId_resource_key" ON "SyncState"("connectionId", "resource");

-- CreateIndex
CREATE INDEX "SyncRun_connectionId_startedAt_idx" ON "SyncRun"("connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "Rule_userId_enabled_priority_idx" ON "Rule"("userId", "enabled", "priority");

-- CreateIndex
CREATE INDEX "Alert_userId_acknowledgedAt_severity_idx" ON "Alert"("userId", "acknowledgedAt", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_userId_dedupeKey_key" ON "Alert"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxProfile_connectionId_key" ON "MailboxProfile"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceProfile_connectionId_key" ON "VoiceProfile"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemTriage_unifiedItemId_key" ON "ItemTriage"("unifiedItemId");

-- CreateIndex
CREATE INDEX "ItemTriage_userId_category_priority_idx" ON "ItemTriage"("userId", "category", "priority");

-- CreateIndex
CREATE INDEX "ItemTriage_userId_needsReply_idx" ON "ItemTriage"("userId", "needsReply");

-- CreateIndex
CREATE UNIQUE INDEX "BillExtraction_unifiedItemId_key" ON "BillExtraction"("unifiedItemId");

-- CreateIndex
CREATE INDEX "BillExtraction_userId_status_dueDate_idx" ON "BillExtraction"("userId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "BillExtraction_userId_isPayable_idx" ON "BillExtraction"("userId", "isPayable");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_unifiedItemId_key" ON "Draft"("unifiedItemId");

-- CreateIndex
CREATE INDEX "Draft_userId_status_createdAt_idx" ON "Draft"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ActionRequest_userId_status_createdAt_idx" ON "ActionRequest"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ActionRequest_connectionId_executedAt_idx" ON "ActionRequest"("connectionId", "executedAt");

-- CreateIndex
CREATE INDEX "TriageFeedback_userId_createdAt_idx" ON "TriageFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialAccount_userId_archived_idx" ON "FinancialAccount"("userId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_userId_bankId_accountId_key" ON "FinancialAccount"("userId", "bankId", "accountId");

-- CreateIndex
CREATE INDEX "StatementImport_userId_importedAt_idx" ON "StatementImport"("userId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatementImport_userId_fileHash_key" ON "StatementImport"("userId", "fileHash");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_postedAt_idx" ON "LedgerEntry"("userId", "postedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_matchStatus_idx" ON "LedgerEntry"("userId", "matchStatus");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_postedAt_idx" ON "LedgerEntry"("accountId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_accountId_fingerprint_key" ON "LedgerEntry"("accountId", "fingerprint");

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarSource" ADD CONSTRAINT "CalendarSource_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_unifiedItemId_fkey" FOREIGN KEY ("unifiedItemId") REFERENCES "UnifiedItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_calendarSourceId_fkey" FOREIGN KEY ("calendarSourceId") REFERENCES "CalendarSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_unifiedItemId_fkey" FOREIGN KEY ("unifiedItemId") REFERENCES "UnifiedItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnifiedItem" ADD CONSTRAINT "UnifiedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncState" ADD CONSTRAINT "SyncState_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxProfile" ADD CONSTRAINT "MailboxProfile_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceProfile" ADD CONSTRAINT "VoiceProfile_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTriage" ADD CONSTRAINT "ItemTriage_unifiedItemId_fkey" FOREIGN KEY ("unifiedItemId") REFERENCES "UnifiedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTriage" ADD CONSTRAINT "ItemTriage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillExtraction" ADD CONSTRAINT "BillExtraction_unifiedItemId_fkey" FOREIGN KEY ("unifiedItemId") REFERENCES "UnifiedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillExtraction" ADD CONSTRAINT "BillExtraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_unifiedItemId_fkey" FOREIGN KEY ("unifiedItemId") REFERENCES "UnifiedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionRequest" ADD CONSTRAINT "ActionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionRequest" ADD CONSTRAINT "ActionRequest_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageFeedback" ADD CONSTRAINT "TriageFeedback_itemTriageId_fkey" FOREIGN KEY ("itemTriageId") REFERENCES "ItemTriage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageFeedback" ADD CONSTRAINT "TriageFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "StatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

