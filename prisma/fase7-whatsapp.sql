-- ---------------------------------------------------------------------------
-- Fase 7A (WhatsApp): mensagens recebidas por canal externo.
-- Rodar UMA vez no banco de producao, depois dos deltas anteriores.
-- Supabase -> SQL Editor -> New query -> colar -> Run.
-- Vai perguntar sobre RLS (cria tabela): "Run and enable RLS".
-- ---------------------------------------------------------------------------

CREATE TYPE "InboxChannel" AS ENUM ('WHATSAPP');

CREATE TYPE "InboxStatus" AS ENUM ('PENDING', 'PROPOSED', 'ACCEPTED', 'REJECTED', 'FAILED');

CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "InboxChannel" NOT NULL DEFAULT 'WHATSAPP',
    "externalId" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "fromName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'TEXT',
    "text" TEXT,
    "mediaId" TEXT,
    "mediaMimeType" TEXT,
    "mediaFileName" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" "InboxStatus" NOT NULL DEFAULT 'PENDING',
    "proposedAmountCents" INTEGER,
    "proposedDirection" TEXT,
    "proposedDescription" TEXT,
    "proposedDate" TIMESTAMP(3),
    "proposedCategory" TEXT,
    "proposedBusiness" TEXT,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "ledgerEntryId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboxMessage_userId_status_receivedAt_idx" ON "InboxMessage"("userId", "status", "receivedAt");

CREATE UNIQUE INDEX "InboxMessage_channel_externalId_key" ON "InboxMessage"("channel", "externalId");

ALTER TABLE "InboxMessage" ADD CONSTRAINT "InboxMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
