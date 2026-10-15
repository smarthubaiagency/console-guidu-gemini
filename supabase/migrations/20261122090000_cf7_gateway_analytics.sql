-- ============================================================================
-- Migration: 20261122090000_cf7_gateway_analytics.sql
-- Module: CF7 — Gateway e analytics (docs/configuracoes/plano-cf7.md,
--         levantamento itens 8, 9 e 16)
--
-- Maintenance Rationale:
-- 1. `public.payment_gateways`: one row per payment gateway of the platform.
--    Only Stripe Connect in this step (Iugu, Asaas, Pagar.me and the
--    partner's own gateway come later and widen the check). On/off, default
--    gateway, test or live mode, and the two credentials (secret key and
--    webhook signing secret) encrypted by the application (AES-256-GCM,
--    src/core/credentials/crypto.ts) with a masked copy for the screen.
--    Real charging stays off until P6 (D-PA-14): the switch only lets the
--    webhook in. Read and written by platform billing (owner, billing).
-- 2. `public.payment_webhook_events`: every webhook call that passed the
--    signature check, with its raw body, unique per provider and event id
--    (a repeated delivery has no second effect). In this step processing
--    only records and marks the event (no subscription changes). Platform
--    billing reads the health and reprocesses the failed ones.
-- 3. The webhook has no identity. Three security definer functions owned by
--    app_rls_helper serve it: the encrypted signing secret of an enabled
--    gateway, the insert of an event (or the existing one), and the mark
--    of the processing result. The helper sees the rows only while a
--    function runs, by a flag set and restored inside it (I5 pattern).
-- 4. Product analytics (Plausible or PostHog) are keys of the settings
--    cascade (ADR 0018, `analytics.*`): no table. The login page and the
--    proxy read them before sign-in through
--    `private.analytics_settings(partner)`, which returns only the
--    `analytics.*` rows of the platform and of the host's partner: switches
--    and public site identifiers, no secret (same pattern as CF5b).
-- 5. History of the gateway: platform billing reads the audit events of the
--    gateway (`platform.billing.gateway.*`) through
--    `private.payment_gateway_history(limit)`; no other audit row.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Functions owned by app_rls_helper get their grants before the ownership
-- transfer (app_migrations is NOINHERIT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Gateways
-- ----------------------------------------------------------------------------
create table public.payment_gateways (
  provider                  text primary key check (provider in ('stripe')),
  enabled                   boolean not null default false,
  is_default                boolean not null default false,
  mode                      text not null default 'test' check (mode in ('test', 'live')),
  secret_key_masked         text check (secret_key_masked is null or length(secret_key_masked) <= 40),
  secret_key_encrypted      text check (secret_key_encrypted is null or length(secret_key_encrypted) <= 4096),
  webhook_secret_masked     text check (webhook_secret_masked is null or length(webhook_secret_masked) <= 40),
  webhook_secret_encrypted  text check (webhook_secret_encrypted is null or length(webhook_secret_encrypted) <= 4096),
  updated_by                uuid not null references public.profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint payment_gateways_secret_key_check
    check ((secret_key_masked is null) = (secret_key_encrypted is null)),
  constraint payment_gateways_webhook_secret_check
    check ((webhook_secret_masked is null) = (webhook_secret_encrypted is null)),
  -- On needs both credentials; the default gateway must be on.
  constraint payment_gateways_enabled_check
    check (not enabled or (secret_key_encrypted is not null and webhook_secret_encrypted is not null)),
  constraint payment_gateways_default_check
    check (not is_default or enabled)
);

-- At most one default gateway.
create unique index payment_gateways_one_default
  on public.payment_gateways (is_default) where is_default;

alter table public.payment_gateways owner to app_migrations;

create trigger payment_gateways_touch_updated_at
  before update on public.payment_gateways
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Webhook events
-- ----------------------------------------------------------------------------
create table public.payment_webhook_events (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null check (provider in ('stripe')),
  event_id       text not null check (event_id ~ '^[A-Za-z0-9_]{1,255}$'),
  event_type     text not null check (event_type ~ '^[a-z0-9_.]{1,120}$'),
  livemode       boolean not null,
  -- Sent by "Enviar webhook de teste" (signed by the application itself).
  is_test        boolean not null default false,
  raw_body       text not null check (octet_length(raw_body) <= 262144),
  status         text not null default 'received'
                   check (status in ('received', 'processed', 'failed')),
  attempts       integer not null default 0 check (attempts >= 0),
  last_error     text check (last_error is null or last_error ~ '^[a-z0-9_]{1,80}$'),
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  -- Milliseconds between the receipt and the first result.
  processing_ms  integer check (processing_ms is null or processing_ms >= 0),
  constraint payment_webhook_events_unique unique (provider, event_id),
  constraint payment_webhook_events_processed_check
    check ((status = 'processed') = (processed_at is not null))
);

create index payment_webhook_events_received_idx
  on public.payment_webhook_events (provider, received_at desc);

alter table public.payment_webhook_events owner to app_migrations;

do $$
declare
  t text;
begin
  foreach t in array array['payment_gateways', 'payment_webhook_events'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. Platform billing (owner, billing) reads and writes
-- ----------------------------------------------------------------------------
create policy payment_gateways_select on public.payment_gateways
  for select to app_runtime
  using (private.can_manage_platform_billing());

create policy payment_gateways_insert on public.payment_gateways
  for insert to app_runtime
  with check (
    updated_by = private.context_uuid('app.user_id')
    and private.can_manage_platform_billing()
  );

create policy payment_gateways_update on public.payment_gateways
  for update to app_runtime
  using (private.can_manage_platform_billing())
  with check (
    updated_by = private.context_uuid('app.user_id')
    and private.can_manage_platform_billing()
  );

grant select, insert on public.payment_gateways to app_runtime;
grant update (enabled, is_default, mode, secret_key_masked, secret_key_encrypted,
              webhook_secret_masked, webhook_secret_encrypted, updated_by)
  on public.payment_gateways to app_runtime;

create policy payment_webhook_events_select on public.payment_webhook_events
  for select to app_runtime
  using (private.can_manage_platform_billing());

-- "Reprocessar": only a failed event changes, to processed or failed again.
create policy payment_webhook_events_reprocess on public.payment_webhook_events
  for update to app_runtime
  using (status = 'failed' and private.can_manage_platform_billing())
  with check (status in ('processed', 'failed') and private.can_manage_platform_billing());

grant select on public.payment_webhook_events to app_runtime;
grant update (status, attempts, last_error, processed_at)
  on public.payment_webhook_events to app_runtime;

-- ----------------------------------------------------------------------------
-- 4. The webhook (no identity): functions owned by app_rls_helper
-- ----------------------------------------------------------------------------
create policy payment_gateways_webhook_helper_select on public.payment_gateways
  for select to app_rls_helper
  using (current_setting('app.payment_webhook', true) = 'on' and enabled);

create policy payment_webhook_events_helper_select on public.payment_webhook_events
  for select to app_rls_helper
  using (current_setting('app.payment_webhook', true) = 'on');

create policy payment_webhook_events_helper_insert on public.payment_webhook_events
  for insert to app_rls_helper
  with check (
    current_setting('app.payment_webhook', true) = 'on'
    and status = 'received'
    and attempts = 0
  );

create policy payment_webhook_events_helper_update on public.payment_webhook_events
  for update to app_rls_helper
  using (current_setting('app.payment_webhook', true) = 'on' and status <> 'processed')
  with check (current_setting('app.payment_webhook', true) = 'on' and status in ('processed', 'failed'));

grant select (provider, enabled, mode, webhook_secret_encrypted)
  on public.payment_gateways to app_rls_helper;
grant select, insert on public.payment_webhook_events to app_rls_helper;
grant update (status, attempts, last_error, processed_at, processing_ms)
  on public.payment_webhook_events to app_rls_helper;

-- The encrypted signing secret and the mode of an enabled gateway; nothing
-- when it is off or has no secret.
create function private.payment_webhook_secret(p_provider text)
returns table(mode text, webhook_secret_encrypted text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.payment_webhook', true);
begin
  perform set_config('app.payment_webhook', 'on', true);
  return query
    select gateway.mode, gateway.webhook_secret_encrypted
    from public.payment_gateways gateway
    where gateway.provider = p_provider
      and gateway.enabled
      and gateway.webhook_secret_encrypted is not null;
  perform set_config('app.payment_webhook', coalesce(v_previous, ''), true);
end;
$$;

-- Stores a verified event, or returns the one already stored under the same
-- id (`inserted` false): a repeated delivery has no second effect.
create function private.payment_webhook_receive(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_is_test boolean,
  p_raw_body text
)
returns table(id uuid, status text, inserted boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.payment_webhook', true);
  v_id uuid;
begin
  perform set_config('app.payment_webhook', 'on', true);
  insert into public.payment_webhook_events
    (provider, event_id, event_type, livemode, is_test, raw_body)
  values (p_provider, p_event_id, p_event_type, p_livemode, p_is_test, p_raw_body)
  on conflict on constraint payment_webhook_events_unique do nothing
  returning payment_webhook_events.id into v_id;
  if v_id is not null then
    return query select v_id, 'received'::text, true;
  else
    return query
      select event.id, event.status, false
      from public.payment_webhook_events event
      where event.provider = p_provider and event.event_id = p_event_id;
  end if;
  perform set_config('app.payment_webhook', coalesce(v_previous, ''), true);
end;
$$;

-- Marks the result of processing an event that is not processed yet. The
-- error is a short code, never a message with data.
create function private.payment_webhook_finish(p_id uuid, p_error text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.payment_webhook', true);
  v_found boolean;
begin
  perform set_config('app.payment_webhook', 'on', true);
  update public.payment_webhook_events event
  set status = case when p_error is null then 'processed' else 'failed' end,
      attempts = event.attempts + 1,
      last_error = p_error,
      processed_at = case when p_error is null then now() else null end,
      processing_ms = coalesce(
        event.processing_ms,
        greatest(0, (extract(epoch from (clock_timestamp() - event.received_at)) * 1000)::integer)
      )
  where event.id = p_id and event.status <> 'processed';
  v_found := found;
  perform set_config('app.payment_webhook', coalesce(v_previous, ''), true);
  return v_found;
end;
$$;

revoke execute on function private.payment_webhook_secret(text) from public, anon, authenticated;
revoke execute on function private.payment_webhook_receive(text, text, text, boolean, boolean, text) from public, anon, authenticated;
revoke execute on function private.payment_webhook_finish(uuid, text) from public, anon, authenticated;
grant execute on function private.payment_webhook_secret(text) to app_runtime;
grant execute on function private.payment_webhook_receive(text, text, text, boolean, boolean, text) to app_runtime;
grant execute on function private.payment_webhook_finish(uuid, text) to app_runtime;
alter function private.payment_webhook_secret(text) owner to app_rls_helper;
alter function private.payment_webhook_receive(text, text, text, boolean, boolean, text) owner to app_rls_helper;
alter function private.payment_webhook_finish(uuid, text) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 5. Product analytics before sign-in (owned by app_rls_helper)
-- ----------------------------------------------------------------------------
create policy settings_helper_analytics_select on public.settings
  for select to app_rls_helper
  using (key like 'analytics.%' and scope in ('platform', 'partner'));

create function private.analytics_settings(p_partner_id uuid)
returns table(scope text, key text, value jsonb, locked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.scope, s.key, s.value, s.locked
  from public.settings s
  where s.key like 'analytics.%'
    and (s.scope = 'platform'
         or (s.scope = 'partner' and s.partner_id = p_partner_id));
$$;

revoke execute on function private.analytics_settings(uuid) from public, anon, authenticated;
grant execute on function private.analytics_settings(uuid) to app_runtime;
alter function private.analytics_settings(uuid) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 6. History of the gateway changes (owned by app_rls_helper)
-- ----------------------------------------------------------------------------
create policy audit_events_gateway_helper_select on public.audit_events
  for select to app_rls_helper
  using (
    action like 'platform.billing.gateway.%'
    and private.current_platform_admin_role() in ('owner', 'billing')
  );

create function private.payment_gateway_history(p_limit integer)
returns table(
  id uuid,
  occurred_at timestamptz,
  action text,
  result text,
  actor_user_id uuid,
  metadata jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.occurred_at, e.action, e.result, e.actor_user_id, e.metadata
  from public.audit_events e
  where e.action like 'platform.billing.gateway.%'
    and private.current_platform_admin_role() in ('owner', 'billing')
  order by e.occurred_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke execute on function private.payment_gateway_history(integer) from public, anon, authenticated;
grant execute on function private.payment_gateway_history(integer) to app_runtime;
alter function private.payment_gateway_history(integer) owner to app_rls_helper;
