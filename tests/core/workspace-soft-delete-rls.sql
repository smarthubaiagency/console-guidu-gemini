-- ============================================================================
-- SQL WS1: complete soft delete of a workspace
--   * `private.workspace_is_active` answers for any workspace, leaves no flag
--   * the channel webhook refuses a workspace scheduled for deletion (or
--     suspended) and accepts again after the cancel
--   * the lifecycle run is queued only by who just requested or canceled
--   * the worker records hooks on open records and reads the external purge
--     data of a purgeable workspace only
--   workspace A a…011 (org a…010): owner a…031, viewer a…033
-- Executed as migration administrator; each block rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid) returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true),
         set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true),
         set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
$$;

-- A connection of A (token hash = sha256 of 'token-ws1') with a GUIDS route.
create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.channel_connections
    (id, organization_id, workspace_id, kind, name, config, encrypted_secrets,
     masked_secret, webhook_token_hash, created_by)
  values
    ('c5a00000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000010',
     'a0000000-0000-4000-8000-000000000011', 'chatwoot', 'Chatwoot WS1',
     '{"base_url": "https://chat.a.test", "account_id": 1, "agent_bot_id": 7}', 'cipher', '••••',
     encode(sha256('token-ws1'::bytea), 'hex'), 'a0000000-0000-4000-8000-000000000031');
  insert into public.channel_routes (organization_id, workspace_id, connection_id, scope, consumer_module, consumer_ref, created_by)
  values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
          'c5a00000-0000-4000-8000-0000000000e1', '10', 'ai-agents', gen_random_uuid(),
          'a0000000-0000-4000-8000-000000000031');
$$;

create or replace function pg_temp.event(p_id text) returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'contractVersion', 1, 'externalId', 'message:' || p_id, 'kind', 'message',
    'sender', 'contact', 'scope', '10',
    'message', jsonb_build_object('text', 'Olá', 'private', false),
    'conversation', jsonb_build_object('externalId', '900', 'contactId', '9', 'status', 'pending')));
$$;

-- ----------------------------------------------------------------------------
-- Test 1: is the workspace active? For runtime and worker, no flag left on
-- ----------------------------------------------------------------------------
begin;
set local role app_worker;
do $$
begin
  if not private.workspace_is_active('a0000000-0000-4000-8000-000000000011') then
    raise exception 'ws1: an active workspace reads as closed';
  end if;
  if private.workspace_is_active(gen_random_uuid()) then
    raise exception 'ws1: an unknown workspace reads as active';
  end if;
  if current_setting('app.workspace_status_check', true) = 'on' then
    raise exception 'ws1: status flag left on';
  end if;
end
$$;
reset role;
update public.workspaces set status = 'suspended' where id = 'a0000000-0000-4000-8000-000000000011';
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  if private.workspace_is_active('a0000000-0000-4000-8000-000000000011') then
    raise exception 'ws1: a suspended workspace reads as active';
  end if;
end
$$;
reset role;
set local role app_rls_helper;
do $$
begin
  if exists (select 1 from public.workspaces where current_setting('app.workspace_status_check', true) = 'on') then
    raise exception 'ws1: helper reads workspaces outside the status check';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: webhook refused while the deletion is scheduled, accepted after
-- the cancel; refused while suspended
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
declare
  v_hash text := encode(sha256('token-ws1'::bytea), 'hex');
  v_row record;
begin
  perform set_config('app.user_id', '', true);
  select * into v_row from private.channel_ingest('c5a00000-0000-4000-8000-0000000000e1', v_hash, pg_temp.event('1'));
  if v_row.stored <> 1 then
    raise exception 'ws1: an active workspace did not take the event';
  end if;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  perform private.request_workspace_deletion(30);

  -- The webhook has no user.
  perform set_config('app.user_id', '', true);
  if private.channel_webhook_connection('c5a00000-0000-4000-8000-0000000000e1', v_hash) is not null then
    raise exception 'ws1: the webhook still knows the connection of a scheduled workspace';
  end if;
  if exists (select 1 from private.channel_ingest('c5a00000-0000-4000-8000-0000000000e1', v_hash, pg_temp.event('2'))) then
    raise exception 'ws1: the ingestion took an event of a scheduled workspace';
  end if;
  if current_setting('app.channel_ingest', true) = 'on' then
    raise exception 'ws1: ingestion flag left on';
  end if;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  if not private.cancel_workspace_deletion('a0000000-0000-4000-8000-000000000011') then
    raise exception 'ws1: the owner could not cancel';
  end if;
  perform set_config('app.user_id', '', true);
  if private.channel_webhook_connection('c5a00000-0000-4000-8000-0000000000e1', v_hash) is distinct from 'chatwoot' then
    raise exception 'ws1: the webhook did not come back after the cancel';
  end if;
  select * into v_row from private.channel_ingest('c5a00000-0000-4000-8000-0000000000e1', v_hash, pg_temp.event('3'));
  if v_row.stored <> 1 then
    raise exception 'ws1: the ingestion did not come back after the cancel';
  end if;
end
$$;
reset role;
do $$
begin
  if exists (select 1 from public.channel_inbound_events where external_id = 'message:2') then
    raise exception 'ws1: an event of the scheduled period was stored';
  end if;
  if (select count(*) from public.channel_inbound_events
      where connection_id = 'c5a00000-0000-4000-8000-0000000000e1') <> 2 then
    raise exception 'ws1: events before and after the deletion were not both stored';
  end if;
  -- One pending GUIDS run for the conversation; none came from the
  -- scheduled period.
  if (select count(*) from public.job_runs
      where kind = 'channels.dispatch' and workspace_id = 'a0000000-0000-4000-8000-000000000011') <> 1 then
    raise exception 'ws1: dispatch runs do not match the open periods';
  end if;
end
$$;
update public.workspaces set status = 'suspended' where id = 'a0000000-0000-4000-8000-000000000011';
set local role app_runtime;
do $$
begin
  perform set_config('app.user_id', '', true);
  if exists (select 1 from private.channel_ingest('c5a00000-0000-4000-8000-0000000000e1',
               encode(sha256('token-ws1'::bytea), 'hex'), pg_temp.event('4'))) then
    raise exception 'ws1: the ingestion took an event of a suspended workspace';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the lifecycle run is queued only for the deletion just requested
-- or canceled, by who did it
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
do $$
declare
  v_deletion uuid;
  v_canceled uuid;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  v_deletion := private.request_workspace_deletion(30);

  -- Another person (the viewer) cannot queue it.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033');
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key, max_attempts)
    values ('privacy.workspace-lifecycle', 'platform', 'a0000000-0000-4000-8000-000000000033',
            jsonb_build_object('deletionId', v_deletion, 'action', 'scheduled'),
            'scheduled:' || v_deletion, 5);
    raise exception 'ws1: a viewer queued the lifecycle run';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  -- Not for a cancel that did not happen.
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key, max_attempts)
    values ('privacy.workspace-lifecycle', 'platform', 'a0000000-0000-4000-8000-000000000031',
            jsonb_build_object('deletionId', v_deletion, 'action', 'canceled'),
            'canceled:' || v_deletion, 5);
    raise exception 'ws1: a cancel run was queued without a cancel';
  exception when insufficient_privilege then null;
  end;
  insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key, max_attempts)
  values ('privacy.workspace-lifecycle', 'platform', 'a0000000-0000-4000-8000-000000000031',
          jsonb_build_object('deletionId', v_deletion, 'action', 'scheduled'),
          'scheduled:' || v_deletion, 5);

  if private.canceled_deletion_id('a0000000-0000-4000-8000-000000000011') is not null then
    raise exception 'ws1: a canceled deletion before the cancel';
  end if;
  perform private.cancel_workspace_deletion('a0000000-0000-4000-8000-000000000011');
  v_canceled := private.canceled_deletion_id('a0000000-0000-4000-8000-000000000011');
  if v_canceled is distinct from v_deletion then
    raise exception 'ws1: the canceled deletion is not the one just canceled';
  end if;
  insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key, max_attempts)
  values ('privacy.workspace-lifecycle', 'platform', 'a0000000-0000-4000-8000-000000000031',
          jsonb_build_object('deletionId', v_deletion, 'action', 'canceled'),
          'canceled:' || v_deletion, 5);

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033');
  if private.canceled_deletion_id('a0000000-0000-4000-8000-000000000011') is not null then
    raise exception 'ws1: the viewer sees the cancel of the owner';
  end if;
end
$$;
reset role;
do $$
begin
  if (select count(*) from public.job_runs
      where kind = 'privacy.workspace-lifecycle' and created_at = now()) <> 2 then
    raise exception 'ws1: lifecycle runs were not queued';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the worker records the lifecycle while the record is not purged,
-- and reads the external purge data of a purgeable workspace only
-- ----------------------------------------------------------------------------
begin;
insert into public.workspace_google_connections
  (organization_id, workspace_id, app_source, account_email, access_token_encrypted,
   refresh_token_encrypted, connected_by)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'platform',
        'conta@example.com', 'cipher-access', 'cipher-refresh', 'a0000000-0000-4000-8000-000000000031');
insert into public.workspace_domains (organization_id, workspace_id, host, cloudflare_hostname_id)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
        'ws1.example.com', 'cf-ws1');
set local role app_runtime;
select pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
select private.request_workspace_deletion(30);
reset role;
set local role app_worker;
do $$
begin
  update public.workspace_deletions
  set lifecycle = '{"scheduled": {"core.x": {"status": "ok"}}}'::jsonb, reminder_sent_at = now()
  where workspace_id = 'a0000000-0000-4000-8000-000000000011' and purged_at is null;
  if not found then raise exception 'ws1: the worker could not record the lifecycle'; end if;
  if exists (select 1 from public.workspace_google_connections)
     or exists (select 1 from public.workspace_domains) then
    raise exception 'ws1: the worker reads the external data before the grace period';
  end if;
end
$$;
reset role;
update public.workspaces set purge_after = now() - interval '1 minute'
where id = 'a0000000-0000-4000-8000-000000000011';
set local role app_worker;
do $$
begin
  if (select refresh_token_encrypted from public.workspace_google_connections
      where workspace_id = 'a0000000-0000-4000-8000-000000000011') is distinct from 'cipher-refresh' then
    raise exception 'ws1: the worker cannot read the token to revoke';
  end if;
  if (select cloudflare_hostname_id from public.workspace_domains
      where workspace_id = 'a0000000-0000-4000-8000-000000000011') is distinct from 'cf-ws1' then
    raise exception 'ws1: the worker cannot read the hostname to remove';
  end if;
  -- The lifecycle never reopens a purge: purged_at stays with its policy.
  update public.workspace_deletions set purged_at = now(), purge_summary = '{}'::jsonb
  where workspace_id = 'a0000000-0000-4000-8000-000000000011' and purged_at is null;
  begin
    update public.workspace_deletions set lifecycle = '{}'::jsonb
    where workspace_id = 'a0000000-0000-4000-8000-000000000011';
    if found then raise exception 'ws1: the worker changed a purged record'; end if;
  end;
end
$$;
rollback;
