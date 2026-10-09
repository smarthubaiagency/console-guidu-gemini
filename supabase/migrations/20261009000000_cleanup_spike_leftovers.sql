-- ============================================================================
-- Migration: 20261009000000_cleanup_spike_leftovers.sql
-- Objetivo: Remoção definitiva de artefatos residuais de spikes (SMA-94) e tabela ad-hoc não autorizada.
-- Contexto e Justificativa:
--   - ADR 0002: Define pg-boss em processo worker separado sob o papel técnico dedicado app_worker.
--     O runtime web (app_runtime) não deve acessar o schema da fila. O spike SMA-94 deixou o schema
--     `sma94_jobs` e concedeu CRUD ao `app_runtime`.
--   - pgmq e fila `sma94_probe`: A ADR 0002 escolheu pg-boss para o produto; pgmq não é utilizado
--     e seus grants concedidos ao `app_runtime` violam o isolamento de privilégios.
--   - ADR 0008 e ADR 0010: Governança do banco de desenvolvimento — proíbem DDL ad-hoc
--     e schemas não versionados. A tabela `public.test_migration_probe` foi criada
--     fora do fluxo de migrations com RLS desativada e permissões para anon/authenticated,
--     sendo identificada no relatório de auditoria de 08/10/2026.
--   - Idempotência: Todas as operações usam cláusulas condicionais (IF EXISTS) para
--     execução segura tanto no banco remoto de desenvolvimento quanto no CI reaplicado do zero.
-- ============================================================================

-- 1. Remoção da tabela ad-hoc não autorizada criada no banco remoto
drop table if exists public.test_migration_probe;

-- 2. Remoção do schema de fila de spike do pg-boss (tabelas, funções e tipos associados)
drop schema if exists sma94_jobs cascade;

-- 3. Remoção segura da fila de probe sma94_probe se a extensão pgmq e a fila existirem
do $$
begin
  if exists (
    select 1
    from information_schema.schemata
    where schema_name = 'pgmq'
  ) and exists (
    select 1
    from information_schema.tables
    where table_schema = 'pgmq' and table_name = 'meta'
  ) then
    if exists (
      select 1
      from pgmq.meta
      where queue_name = 'sma94_probe'
    ) then
      perform pgmq.drop_queue('sma94_probe');
    end if;
  end if;
end
$$;

-- 4. Remoção da extensão pgmq
drop extension if exists pgmq cascade;
