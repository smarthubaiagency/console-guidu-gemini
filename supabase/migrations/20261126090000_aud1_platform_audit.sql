-- ============================================================================
-- Migration: 20261126090000_aud1_platform_audit.sql
-- Module: AUD1 — Plataforma › Auditoria: the whole `audit_events` trail for
--         the platform (docs/architecture/central-de-eventos.md, seções 5 e 6)
--
-- Maintenance Rationale:
-- 1. Until now `audit_events` had only two readings: the security slice
--    (CF5a, `private.security_events`) and the gateway history (CF7). The
--    platform could not read the rest of the trail. `audit_events` stays
--    without direct reads: app_runtime keeps INSERT only.
-- 2. `private.platform_audit_events(...)` returns the trail to the platform
--    with filters (partner, company, workspace, action prefix, result,
--    origin, actor and period) and a keyset cursor on (occurred_at, id),
--    newest first, at most 200 rows per call.
-- 3. Separation by platform role:
--    - owner, operations and support read every event, with its metadata
--      (the metadata is already reduced to the allowlist of
--      `src/core/audit/record.ts` when it is written: no secrets);
--    - billing reads only the billing actions, decided by
--      `private.is_billing_audit_action(action)` on the real prefixes of
--      the code: `billing.` (plans, versions, splits, terms, refunds,
--      subscriptions, quotas, checkout block), `platform.billing.`
--      (gateway), `partner.billing.` (partner plans and profile),
--      `partner.payment.` (manual payments), `partner.subscription.`
--      (partner subscriptions) and `partner.checkout.` (checkout switch);
--    - partners, customers and anyone without an active platform role read
--      nothing.
-- 4. The partner of an event is the `partnerId` of its metadata or, when
--    there is none, the partner of its company. Names are not returned:
--    the server resolves partner, company, workspace and actor names
--    through what the role already reads.
-- 5. `is_security` tells the screen when the event is also in the security
--    events of CF5a (same rule, `private.is_security_event`).
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Which audit actions are billing actions (the platform billing role)
-- ----------------------------------------------------------------------------
create function private.is_billing_audit_action(p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_action like 'billing.%'
    or p_action like 'platform.billing.%'
    or p_action like 'partner.billing.%'
    or p_action like 'partner.payment.%'
    or p_action like 'partner.subscription.%'
    or p_action like 'partner.checkout.%';
$$;

alter function private.is_billing_audit_action(text) owner to app_migrations;
revoke execute on function private.is_billing_audit_action(text) from public, anon, authenticated;
grant execute on function private.is_billing_audit_action(text) to app_runtime, app_rls_helper;

-- ----------------------------------------------------------------------------
-- 2. The helper reads the trail for the platform, by role
-- ----------------------------------------------------------------------------
-- Owner, operations and support already read every row through
-- audit_events_security_helper_select (CF5a); this policy states the AUD1
-- rule on its own, so the reading does not depend on the security one, and
-- adds the billing slice.
create policy audit_events_platform_audit_helper_select on public.audit_events
  for select to app_rls_helper
  using (
    private.current_platform_admin_role() in ('owner', 'operations', 'support')
    or (private.current_platform_admin_role() = 'billing'
        and private.is_billing_audit_action(action))
  );

-- Cursor reading: newest first, ties broken by id.
create index idx_audit_events_occurred_at_id
  on public.audit_events (occurred_at desc, id desc);

create function private.platform_audit_events(
  p_partner_id uuid,
  p_organization_id uuid,
  p_workspace_id uuid,
  p_action_prefix text,
  p_result text,
  p_origin text,
  p_actor_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_before_at timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table(
  id uuid,
  occurred_at timestamptz,
  action text,
  result text,
  origin text,
  actor_user_id uuid,
  actor_principal_type text,
  represented_user_id uuid,
  organization_id uuid,
  workspace_id uuid,
  partner_id text,
  resource_type text,
  resource_id text,
  client_id text,
  request_id text,
  metadata jsonb,
  is_security boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select private.current_platform_admin_role() as role
  )
  select e.id, e.occurred_at, e.action, e.result, e.origin, e.actor_user_id,
         e.actor_principal_type, e.represented_user_id, e.organization_id,
         e.workspace_id,
         coalesce(nullif(e.metadata ->> 'partnerId', ''), o.partner_id::text),
         e.resource_type, e.resource_id, e.client_id, e.request_id,
         e.metadata,
         private.is_security_event(e.action, e.metadata)
  from public.audit_events e
  cross join viewer v
  left join public.organizations o on o.id = e.organization_id
  where (
      v.role in ('owner', 'operations', 'support')
      or (v.role = 'billing' and private.is_billing_audit_action(e.action))
    )
    and (p_partner_id is null
         or coalesce(nullif(e.metadata ->> 'partnerId', ''), o.partner_id::text)
            = p_partner_id::text)
    and (p_organization_id is null or e.organization_id = p_organization_id)
    and (p_workspace_id is null or e.workspace_id = p_workspace_id)
    -- A prefix, compared as text: `%` and `_` are not wildcards here.
    and (coalesce(p_action_prefix, '') = ''
         or left(e.action, length(p_action_prefix)) = p_action_prefix)
    and (p_result is null or e.result = p_result)
    and (p_origin is null or e.origin = p_origin)
    and (p_actor_user_id is null or e.actor_user_id = p_actor_user_id)
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at < p_to)
    and (p_before_at is null
         or (e.occurred_at, e.id)
            < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by e.occurred_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke execute on function private.platform_audit_events(
  uuid, uuid, uuid, text, text, text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function private.platform_audit_events(
  uuid, uuid, uuid, text, text, text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer
) to app_runtime;
alter function private.platform_audit_events(
  uuid, uuid, uuid, text, text, text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer
) owner to app_rls_helper;
