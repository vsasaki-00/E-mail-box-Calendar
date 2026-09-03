-- ---------------------------------------------------------------------------
-- Fase 8: negocios em tabela, para voce cadastrar e renomear sem deploy.
-- Rodar UMA vez no banco de producao. Supabase -> SQL Editor -> Run.
-- Cria tabela, entao o aviso de RLS aparece: "Run and enable RLS".
--
-- Os seis negocios de hoje sao criados na PRIMEIRA vez que a tela abre,
-- a partir da lista que estava em codigo. Nada some.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Business_userId_archived_sortOrder_idx" ON "Business"("userId", "archived", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Business_userId_name_key" ON "Business"("userId", "name");

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

