-- ============================================================================
-- Migration: 20261017091000_f3e_mfa_audit.sql
-- Module: F3e — Audit of MFA enrolment (pendência C11)
--
-- APPLY AS `postgres`: the trigger lives on `auth.mfa_factors`, owned by
-- Supabase Auth; `postgres` holds the TRIGGER privilege there and BYPASSRLS
-- (checked on dev, 17/10/2026). The migration stops with a clear message
-- under any other role, and skips the trigger where the table does not
-- exist (test databases without Supabase Auth).
--
-- Maintenance Rationale:
-- 1. Supabase Auth writes MFA factors outside the application's
--    transactions, so the audit is written by the database itself, in the
--    same transaction as the factor change: `auth.mfa_enrolled` when a
--    factor becomes verified, `auth.mfa_unenrolled` when a verified factor
--    is removed. Unverified attempts are not audited.
-- 2. The event names the user as actor and the factor as resource, with
--    origin `app` and only the factor type in the metadata (no secret, no
--    friendly name).
-- 3. The function is security definer owned by postgres (BYPASSRLS), so
--    it writes to the append-only audit table regardless of request
--    context; nothing else can call it (it returns `trigger`).
-- ============================================================================

do $$
begin
  if current_user <> 'postgres'
     or not (select rolsuper or rolbypassrls from pg_roles where rolname = current_user)
     or not has_table_privilege(current_user, 'public.audit_events', 'INSERT') then
    raise exception 'F3e: aplique esta migration como postgres (BYPASSRLS e INSERT em audit_events); current_user = %', current_user;
  end if;
end
$$;

create or replace function private.audit_mfa_factor_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status::text = 'verified' then
      insert into public.audit_events
        (actor_user_id, actor_principal_type, origin, action, resource_type, resource_id, result, metadata)
      values
        (old.user_id, 'user', 'app', 'auth.mfa_unenrolled', 'mfa_factor', old.id::text, 'success',
         jsonb_build_object('factorType', old.factor_type::text));
    end if;
    return old;
  end if;
  if new.status::text = 'verified'
     and (tg_op = 'INSERT' or old.status::text is distinct from 'verified') then
    insert into public.audit_events
      (actor_user_id, actor_principal_type, origin, action, resource_type, resource_id, result, metadata)
    values
      (new.user_id, 'user', 'app', 'auth.mfa_enrolled', 'mfa_factor', new.id::text, 'success',
       jsonb_build_object('factorType', new.factor_type::text));
  end if;
  return new;
end;
$$;

revoke execute on function private.audit_mfa_factor_change() from public, anon, authenticated;

do $$
begin
  if to_regclass('auth.mfa_factors') is null then
    raise notice 'auth.mfa_factors not found; MFA audit trigger skipped';
    return;
  end if;
  execute 'drop trigger if exists audit_mfa_factor_change on auth.mfa_factors';
  execute 'create trigger audit_mfa_factor_change
             after insert or update of status or delete on auth.mfa_factors
             for each row execute function private.audit_mfa_factor_change()';
end
$$;
