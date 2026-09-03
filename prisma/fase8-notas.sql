-- ---------------------------------------------------------------------------
-- Fase 8: nota esperando o extrato.
-- Rodar UMA vez no banco de producao. Supabase -> SQL Editor -> Run.
-- So acrescenta um valor ao enum; nao cria tabela, entao nao ha aviso de RLS.
-- ---------------------------------------------------------------------------

ALTER TYPE "InboxStatus" ADD VALUE IF NOT EXISTS 'WAITING_STATEMENT';
