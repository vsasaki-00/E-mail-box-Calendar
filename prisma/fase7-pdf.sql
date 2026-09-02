-- ---------------------------------------------------------------------------
-- Fase 7B (extrato em PDF): um valor novo no enum LedgerSource.
-- Rodar UMA vez no banco de producao que ja recebeu prisma/fase7-extrato.sql.
--
-- Uso: Supabase -> SQL Editor -> New query -> colar -> Run.
-- Idempotente: IF NOT EXISTS. Nao cria tabela, entao o Supabase nao vai
-- perguntar sobre RLS.
-- ---------------------------------------------------------------------------

ALTER TYPE "LedgerSource" ADD VALUE IF NOT EXISTS 'PDF';
