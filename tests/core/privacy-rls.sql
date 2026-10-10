-- ============================================================================
-- SQL Privacy (F3e): workspace deletion with grace period, purge, exports,
-- retention by category and the MFA audit trigger
--
-- Executed as migration administrator; each block rolls back.
--   org A a…010, workspace A a…011, owner a…031, viewer a…033
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid) returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', 'a0000000-0000-4000-8000-000000000011', true),
         set_config('app.organization_id', 'a0000000-0000-4000-8000-000000000010', true),
         set_config('app.partner_id', '00000000-0000-4000-8000-000000000000', true);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: only the owner schedules; the workspace closes at once; cancel
-- ----------------------------------------------------------------------------
begin;
insert into public.hello_world_records (organization_id, workspace_id, title, created_by)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'F3e', 'a0000000-0000-4000-8000-000000000031');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033');
  begin
    perform private.request_workspace_deletion(30);
    raise exception 'privacy: a viewer scheduled the deletion';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  begin
    perform private.request_workspace_deletion(1);
    raise exception 'privacy: a grace period other than 30 days was accepted';
  exception when check_violation then null;
  end;
  perform private.request_workspace_deletion(30);

  -- Nobody reaches the workspace or its data during the grace period.
  if private.is_workspace_member('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010')
     or private.current_workspace_role() is not null
     or (select count(*) from public.hello_world_records) <> 0
     or (select count(*) from public.workspaces where id = 'a0000000-0000-4000-8000-000000000011') <> 0 then
    raise exception 'privacy: a scheduled workspace is still open';
  end if;
  if (select count(*) from private.list_scheduled_deletions()) <> 1 then
    raise exception 'privacy: the owner does not see the scheduled deletion';
  end if;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033');
  if (select count(*) from private.list_scheduled_deletions()) <> 0 then
    raise exception 'privacy: a viewer sees the scheduled deletion';
  end if;
  if private.cancel_workspace_deletion('a0000000-0000-4000-8000-000000000011') then
    raise exception 'privacy: a viewer canceled the deletion';
  end if;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  if not private.cancel_workspace_deletion('a0000000-0000-4000-8000-000000000011') then
    raise exception 'privacy: the owner could not cancel';
  end if;
  if (select count(*) from public.hello_world_records) <> 1 then
    raise exception 'privacy: data is not back after the cancel';
  end if;
end
$$;
reset role;
do $$
begin
  if (select count(*) from public.workspace_deletions
      where workspace_id = 'a0000000-0000-4000-8000-000000000011' and canceled_at is not null) <> 1 then
    raise exception 'privacy: the canceled request was not recorded';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: the worker purges only after the grace period; tombstone stays
-- ----------------------------------------------------------------------------
begin;
insert into public.hello_world_records (organization_id, workspace_id, title, created_by)
values ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'F3e', 'a0000000-0000-4000-8000-000000000031');
set local role app_runtime;
select pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
select private.request_workspace_deletion(30);
reset role;

set local role app_worker;
do $$
begin
  delete from public.hello_world_records where workspace_id = 'a0000000-0000-4000-8000-000000000011';
  if found then raise exception 'privacy: purged during the grace period'; end if;
  update public.workspaces set status = 'deleted', deleted_at = now(), purge_after = null
  where id = 'a0000000-0000-4000-8000-000000000011';
  if found then raise exception 'privacy: tombstone written during the grace period'; end if;
  -- Other workspaces are never purgeable.
  delete from public.workspace_members where workspace_id = 'a0000000-0000-4000-8000-000000000021';
  if found then raise exception 'privacy: worker deleted an active workspace member'; end if;
end
$$;
reset role;

update public.workspaces set purge_after = now() - interval '1 minute'
where id = 'a0000000-0000-4000-8000-000000000011';

set local role app_worker;
do $$
begin
  delete from public.hello_world_records where workspace_id = 'a0000000-0000-4000-8000-000000000011';
  if not found then raise exception 'privacy: worker could not purge module data'; end if;
  delete from public.workspace_members where workspace_id = 'a0000000-0000-4000-8000-000000000011';
  if not found then raise exception 'privacy: worker could not purge members'; end if;
  update public.workspaces
  set status = 'deleted', deleted_at = now(), purge_after = null,
      name = 'Workspace excluído', slug = 'excluido-a0000000'
  where id = 'a0000000-0000-4000-8000-000000000011';
  if not found then raise exception 'privacy: worker could not write the tombstone'; end if;
  update public.workspace_deletions set purged_at = now(), purge_summary = '{"rows": 2}'
  where workspace_id = 'a0000000-0000-4000-8000-000000000011';
  if not found then raise exception 'privacy: worker could not close the record'; end if;
  -- A deleted workspace never comes back through the worker.
  update public.workspaces set status = 'active' where id = 'a0000000-0000-4000-8000-000000000011';
  if found then raise exception 'privacy: worker revived a deleted workspace'; end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: exports by owner/admin, written by the requester's job
-- ----------------------------------------------------------------------------
begin;
set local role app_runtime;
do $$
declare
  v_id uuid;
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033');
  begin
    insert into public.workspace_exports (workspace_id, organization_id, requested_by)
    values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
            'a0000000-0000-4000-8000-000000000033');
    raise exception 'privacy: a viewer asked for an export';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.workspace_exports) <> 0 then
    raise exception 'privacy: a viewer reads exports';
  end if;

  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  insert into public.workspace_exports (workspace_id, organization_id, requested_by)
  values ('a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000031')
  returning id into v_id;
  update public.workspace_exports
  set status = 'ready', file = convert_to('{}', 'UTF8'), file_size = 2,
      sha256 = repeat('a', 64), expires_at = now() + interval '24 hours'
  where id = v_id;
  if not found then raise exception 'privacy: the requester job could not write the file'; end if;
  update public.workspace_exports set file = convert_to('{"x":1}', 'UTF8') where id = v_id;
  if found then raise exception 'privacy: a ready export changed'; end if;
end
$$;
reset role;

-- Expiry by the worker, only past the date.
set local role app_worker;
do $$
begin
  update public.workspace_exports set status = 'expired', file = null where status = 'ready';
  if found then raise exception 'privacy: worker expired an export before its date'; end if;
  begin
    perform file from public.workspace_exports;
    raise exception 'privacy: worker reads export files';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
update public.workspace_exports set expires_at = now() - interval '1 minute';
set local role app_worker;
do $$
begin
  update public.workspace_exports set status = 'expired', file = null where status = 'ready';
  if not found then raise exception 'privacy: worker could not expire an export'; end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: retention stays off until a category is enabled
-- ----------------------------------------------------------------------------
begin;
insert into public.job_runs (kind, organization_id, workspace_id, requested_by, idempotency_key, status, finished_at)
values ('hello-world.create-record', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011',
        'a0000000-0000-4000-8000-000000000031', 'f3e-old', 'succeeded', now() - interval '400 days');
set local role app_worker;
do $$
begin
  delete from public.job_runs where idempotency_key = 'f3e-old';
  if found then raise exception 'privacy: retention deleted while disabled'; end if;
end
$$;
reset role;
update public.retention_policies
set enabled = true, retain_days = 365, legal_basis = 'teste'
where category = 'job_runs';
set local role app_worker;
do $$
begin
  delete from public.job_runs where idempotency_key = 'f3e-old';
  if not found then raise exception 'privacy: enabled retention did not apply'; end if;
end
$$;
reset role;
do $$
begin
  begin
    update public.retention_policies set enabled = true, retain_days = 30 where category = 'audit_events';
    raise exception 'privacy: a manual category was automated';
  exception when check_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: MFA enrolment is audited by the database (C11)
-- ----------------------------------------------------------------------------
begin;
do $$
begin
  if to_regclass('auth.mfa_factors') is null then
    raise notice 'auth.mfa_factors absent; MFA audit not tested here';
    return;
  end if;
  execute $sql$
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status)
    values ('f3e00000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000031', 'Telefone', 'totp', 'unverified')
  $sql$;
  if exists (select 1 from public.audit_events where resource_id = 'f3e00000-0000-4000-8000-0000000000f1') then
    raise exception 'privacy: an unverified factor was audited';
  end if;
  execute $sql$ update auth.mfa_factors set status = 'verified' where id = 'f3e00000-0000-4000-8000-0000000000f1' $sql$;
  execute $sql$ delete from auth.mfa_factors where id = 'f3e00000-0000-4000-8000-0000000000f1' $sql$;
  if (select array_agg(action order by occurred_at, action) from public.audit_events
      where resource_id = 'f3e00000-0000-4000-8000-0000000000f1'
        and actor_user_id = 'a0000000-0000-4000-8000-000000000031'
        and metadata = '{"factorType": "totp"}') is distinct from array['auth.mfa_enrolled', 'auth.mfa_unenrolled'] then
    raise exception 'privacy: MFA enrolment and removal were not audited';
  end if;
end
$$;
rollback;
