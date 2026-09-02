-- ---------------------------------------------------------------------------
-- Fase 7B (categorias): tabela de regras aprendidas das suas correcoes, e
-- a coluna que diz quem deu a categoria de cada lancamento.
-- Rodar UMA vez no banco de producao. Supabase -> SQL Editor -> Run.
-- Vai perguntar sobre RLS (cria tabela): "Run and enable RLS".
-- ---------------------------------------------------------------------------

ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "categorySource" TEXT;

CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" TEXT,
    "business" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CategoryRule_userId_idx" ON "CategoryRule"("userId");

CREATE UNIQUE INDEX "CategoryRule_userId_pattern_key" ON "CategoryRule"("userId", "pattern");

ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
