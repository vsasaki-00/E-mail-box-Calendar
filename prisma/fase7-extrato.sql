-- ---------------------------------------------------------------------------
-- Fase 7B: tabelas de extrato bancario. Rodar UMA vez no banco de producao
-- que JA tem as tabelas anteriores (prisma/producao.sql).
--
-- Uso: Supabase -> SQL Editor -> New query -> colar -> Run.
-- So cria objetos novos; nao toca em nada que ja existe.
--
-- Gerado de prisma/schema.prisma (filtro dos objetos novos de
--   npx prisma migrate diff --from-empty --to-schema-datamodel ... --script)
-- ---------------------------------------------------------------------------

CREATE TYPE "FinancialAccountKind" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'CASH', 'INVESTMENT', 'OTHER');

CREATE TYPE "LedgerSource" AS ENUM ('OFX', 'CSV', 'MANUAL');

CREATE TYPE "MatchStatus" AS ENUM ('NONE', 'SUGGESTED', 'CONFIRMED', 'REJECTED');

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

CREATE INDEX "FinancialAccount_userId_archived_idx" ON "FinancialAccount"("userId", "archived");

CREATE UNIQUE INDEX "FinancialAccount_userId_bankId_accountId_key" ON "FinancialAccount"("userId", "bankId", "accountId");

CREATE INDEX "StatementImport_userId_importedAt_idx" ON "StatementImport"("userId", "importedAt");

CREATE UNIQUE INDEX "StatementImport_userId_fileHash_key" ON "StatementImport"("userId", "fileHash");

CREATE INDEX "LedgerEntry_userId_postedAt_idx" ON "LedgerEntry"("userId", "postedAt");

CREATE INDEX "LedgerEntry_userId_matchStatus_idx" ON "LedgerEntry"("userId", "matchStatus");

CREATE INDEX "LedgerEntry_accountId_postedAt_idx" ON "LedgerEntry"("accountId", "postedAt");

CREATE UNIQUE INDEX "LedgerEntry_accountId_fingerprint_key" ON "LedgerEntry"("accountId", "fingerprint");

ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "StatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
