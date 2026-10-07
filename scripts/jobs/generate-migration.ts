import { mkdir, writeFile } from 'node:fs/promises'
import { getConstructionPlans } from 'pg-boss'

const path = 'supabase/migrations/20261007230000_sma94_jobs_spike.sql'
const bossSql = getConstructionPlans('sma94_jobs')
const appSql = `

-- SMA-94 additions: pg-boss stays infrastructure-only; tenant effects remain
-- in an RLS-protected domain table and are re-authorized at execution time.
select sma94_jobs.create_queue(
  'sma94-dead',
  '{"policy":"standard","retryLimit":0,"expireInSeconds":30,"deleteAfterSeconds":86400}'::jsonb
);
select sma94_jobs.create_queue(
  'sma94-work',
  '{"policy":"standard","retryLimit":2,"retryDelay":1,"retryBackoff":true,"retryDelayMax":4,"expireInSeconds":10,"deleteAfterSeconds":86400,"deadLetter":"sma94-dead"}'::jsonb
);

create table public.sma94_job_effects (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  workspace_id uuid not null,
  organization_id uuid not null,
  effect_count integer not null default 1 check (effect_count = 1),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, organization_id)
    references public.spike_workspaces(id, organization_id) on delete cascade
);

create index sma94_job_effects_workspace_organization_idx
  on public.sma94_job_effects (workspace_id, organization_id);

alter table public.sma94_job_effects owner to app_migrations;
alter table public.sma94_job_effects enable row level security;
alter table public.sma94_job_effects force row level security;

create policy sma94_job_effects_select on public.sma94_job_effects
  for select to app_runtime
  using (spike_private.is_current_member(workspace_id, organization_id));
create policy sma94_job_effects_insert on public.sma94_job_effects
  for insert to app_runtime
  with check (spike_private.is_current_member(workspace_id, organization_id));
create policy sma94_job_effects_update on public.sma94_job_effects
  for update to app_runtime
  using (spike_private.is_current_member(workspace_id, organization_id))
  with check (spike_private.is_current_member(workspace_id, organization_id));
create policy sma94_job_effects_delete on public.sma94_job_effects
  for delete to app_runtime
  using (spike_private.is_current_member(workspace_id, organization_id));

revoke all on public.sma94_job_effects from public, anon, authenticated;
grant select, insert, update, delete on public.sma94_job_effects to app_runtime;

revoke all on schema sma94_jobs from public, anon, authenticated;
grant usage on schema sma94_jobs to app_runtime;
grant select, insert, update, delete on all tables in schema sma94_jobs to app_runtime;
grant usage, select on all sequences in schema sma94_jobs to app_runtime;
grant execute on all functions in schema sma94_jobs to app_runtime;
revoke execute on function sma94_jobs.create_queue(text, jsonb) from app_runtime;
revoke execute on function sma94_jobs.delete_queue(text) from app_runtime;
`

await mkdir('supabase/migrations', { recursive: true })
await writeFile(path, `-- Generated from pg-boss 12.37.0 getConstructionPlans('sma94_jobs').\n${bossSql}${appSql}`)
console.log(path)
