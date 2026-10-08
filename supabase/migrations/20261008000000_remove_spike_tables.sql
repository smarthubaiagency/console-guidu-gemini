-- ============================================================================
-- Migration: 20261008000000_remove_spike_tables.sql
-- Objetivo: Remoção segura das tabelas transitórias do spike de validação (SMA-92 e SMA-94)
-- Contexto: A prova de conceito inicial utilizou as tabelas spike_notes, spike_workspaces,
--           spike_organizations, spike_workspace_members e sma94_job_effects.
--           Esta migration limpa esses artefatos para a introdução do schema do núcleo.
-- Manutenção:
--   * Os papéis app_migrations e app_runtime são mantidos intencionalmente.
--   * sma94_job_effects deve ser removida antes por possuir FK para spike_workspaces.
-- ============================================================================

drop table if exists public.sma94_job_effects;
drop table if exists public.spike_notes;
drop table if exists public.spike_workspace_members;
drop table if exists public.spike_workspaces;
drop table if exists public.spike_organizations;
drop function if exists spike_private.is_current_member(uuid, uuid);
drop function if exists spike_private.context_uuid(text);
drop schema if exists spike_private;
