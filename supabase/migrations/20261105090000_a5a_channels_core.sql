-- ============================================================================
-- Migration: 20261105090000_a5a_channels_core.sql
-- Module: A5a — Messaging channels in the core (ADR 0011; canais.md §3;
--         plano-a5.md)
--
-- Maintenance Rationale:
-- 1. The integration with messaging providers belongs to the core (ADR 0011):
--    connections of a workspace, the routes that give each (connection,
--    scope) to one consumer module, the external conversations and the
--    inbound events. The first provider is Chatwoot through an Agent Bot.
-- 2. `channel_connections` keeps the non-secret configuration in `config`
--    and the provider's tokens encrypted by the server (same envelope as the
--    vault of the A2a), never in clear. The webhook URL carries a random
--    token per connection, kept only as its SHA-256 (`webhook_token_hash`).
-- 3. The webhook has no user: it reaches the database only through two
--    security definer functions (owner app_rls_helper), which check the
--    token's hash and write the normalized events with a unique external id
--    (a provider's retry writes nothing). They see the tables only while
--    they run (flag `app.channel_ingest`, set and restored, I5 pattern).
-- 4. Members with `channels.read` (owner, admin, editor) see connections,
--    routes, conversations and events of their workspace; `channels.manage`
--    (owner, admin) creates, changes and removes connections and routes.
--    Events and conversations are written only by the ingestion.
-- 5. At most one active route per (connection, scope): a unique index, not
--    only the screens. The consumers (A5b) create their routes.
-- 6. Purge of a deleted workspace (F3e) as the worker, like every table of a
--    workspace.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table public.channel_connections (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  workspace_id       uuid not null,
  kind               text not null check (kind in ('chatwoot')),
  name               text not null check (length(name) between 1 and 80),
  status             text not null default 'active' check (status in ('active', 'disabled')),
  -- Non-secret settings of the provider (Chatwoot: base_url, account_id,
  -- agent_bot_id).
  config             jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  -- The provider's tokens, encrypted by the server; never returned.
  encrypted_secrets  text not null check (length(encrypted_secrets) > 0),
  masked_secret      text not null check (length(masked_secret) between 1 and 40),
  webhook_token_hash text not null unique check (webhook_token_hash ~ '^[0-9a-f]{64}$'),
  health_status      text not null default 'unknown' check (health_status in ('unknown', 'ok', 'failed')),
  health_error       text check (health_error is null or length(health_error) <= 80),
  health_checked_at  timestamptz,
  last_event_at      timestamptz,
  created_by         uuid not null,
  updated_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint channel_connections_id_workspace_key unique (id, workspace_id),
  constraint fk_channel_connections_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index channel_connections_workspace_idx
  on public.channel_connections (workspace_id, created_at);

create table public.channel_routes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  workspace_id     uuid not null,
  connection_id    uuid not null,
  -- Chatwoot: the inbox id.
  scope            text not null check (length(scope) between 1 and 200),
  consumer_module  text not null check (consumer_module ~ '^[a-z][a-z0-9-]{1,62}$'),
  -- What the consumer uses to find its configuration (ai-agents: the binding).
  consumer_ref     uuid not null,
  status           text not null default 'active' check (status in ('active', 'paused', 'closed')),
  created_by       uuid not null,
  updated_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint channel_routes_id_workspace_key unique (id, workspace_id),
  constraint fk_channel_routes_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_channel_routes_connection
    foreign key (connection_id, workspace_id)
    references public.channel_connections(id, workspace_id) on delete cascade
);

-- One owner per (connection, scope) at a time (ADR 0011, decision 3).
create unique index channel_routes_one_active
  on public.channel_routes (connection_id, scope) where status = 'active';

create table public.channel_conversations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  workspace_id        uuid not null,
  connection_id       uuid not null,
  scope               text not null check (length(scope) between 1 and 200),
  external_id         text not null check (length(external_id) between 1 and 200),
  external_contact_id text check (external_contact_id is null or length(external_contact_id) between 1 and 200),
  -- The provider's status (Chatwoot: pending, open, resolved, snoozed).
  external_status     text check (external_status is null or length(external_status) <= 40),
  created_at          timestamptz not null default now(),
  last_event_at       timestamptz not null default now(),
  constraint channel_conversations_id_workspace_key unique (id, workspace_id),
  constraint channel_conversations_external_key unique (connection_id, external_id),
  constraint fk_channel_conversations_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_channel_conversations_connection
    foreign key (connection_id, workspace_id)
    references public.channel_connections(id, workspace_id) on delete cascade
);

create table public.channel_inbound_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  workspace_id     uuid not null,
  connection_id    uuid not null,
  conversation_id  uuid,
  -- The provider's id of the event: a retry writes nothing.
  external_id      text not null check (length(external_id) between 1 and 200),
  contract_version integer not null check (contract_version >= 1),
  kind             text not null check (kind in ('message', 'conversation_status')),
  sender           text not null check (sender in ('contact', 'agent', 'bot', 'system')),
  scope            text not null check (length(scope) between 1 and 200),
  -- The normalized event (contract of src/core/channels/contract.ts), never
  -- the provider's raw payload.
  payload          jsonb not null check (jsonb_typeof(payload) = 'object'),
  status           text not null check (status in ('no_route', 'routed', 'dispatched', 'ignored', 'failed')),
  occurred_at      timestamptz,
  received_at      timestamptz not null default now(),
  constraint channel_inbound_events_external_key unique (connection_id, external_id),
  constraint fk_channel_inbound_events_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_channel_inbound_events_connection
    foreign key (connection_id, workspace_id)
    references public.channel_connections(id, workspace_id) on delete cascade,
  constraint fk_channel_inbound_events_conversation
    foreign key (conversation_id, workspace_id)
    references public.channel_conversations(id, workspace_id) on delete cascade
);

create index channel_inbound_events_connection_idx
  on public.channel_inbound_events (connection_id, received_at desc);
create index channel_inbound_events_conversation_idx
  on public.channel_inbound_events (conversation_id, received_at);

do $$
declare
  t text;
begin
  foreach t in array array['channel_connections', 'channel_routes', 'channel_conversations', 'channel_inbound_events'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
  foreach t in array array['channel_connections', 'channel_routes'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;

-- Owner, author and creation time never change.
create function private.channels_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.organization_id is distinct from old.organization_id
     or new.created_at is distinct from old.created_at then
    raise exception 'channels: id, owner and creation time are immutable'
      using errcode = 'check_violation';
  end if;
  -- Nested ifs: each table only has its own columns.
  if tg_table_name = 'channel_connections' then
    if new.created_by is distinct from old.created_by or new.kind is distinct from old.kind then
      raise exception 'channels: the author and kind of a connection are immutable'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'channel_routes' then
    if new.created_by is distinct from old.created_by
       or new.connection_id is distinct from old.connection_id
       or new.scope is distinct from old.scope
       or new.consumer_module is distinct from old.consumer_module then
      raise exception 'channels: a route changes only its status'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'channel_conversations' then
    if new.connection_id is distinct from old.connection_id
       or new.external_id is distinct from old.external_id then
      raise exception 'channels: a conversation keeps its connection and id'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

alter function private.channels_guard_update() owner to app_migrations;
revoke execute on function private.channels_guard_update() from public, anon, authenticated;

create trigger channel_connections_guard_update
  before update on public.channel_connections
  for each row execute function private.channels_guard_update();
create trigger channel_routes_guard_update
  before update on public.channel_routes
  for each row execute function private.channels_guard_update();
create trigger channel_conversations_guard_update
  before update on public.channel_conversations
  for each row execute function private.channels_guard_update();

-- ----------------------------------------------------------------------------
-- 2. Policies of the workspace (app_runtime)
-- ----------------------------------------------------------------------------
-- channels.read = owner, admin, editor; channels.manage = owner, admin
-- (src/core/permissions/matrix.ts).
create policy channel_connections_select on public.channel_connections
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

create policy channel_connections_insert on public.channel_connections
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy channel_connections_update on public.channel_connections
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy channel_connections_delete on public.channel_connections
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert, update, delete on public.channel_connections to app_runtime;

create policy channel_routes_select on public.channel_routes
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

create policy channel_routes_insert on public.channel_routes
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy channel_routes_update on public.channel_routes
  for update to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy channel_routes_delete on public.channel_routes
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert, update, delete on public.channel_routes to app_runtime;

create policy channel_conversations_select on public.channel_conversations
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

create policy channel_inbound_events_select on public.channel_inbound_events
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

grant select on public.channel_conversations, public.channel_inbound_events to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. Ingestion from the webhook (owned by app_rls_helper)
-- ----------------------------------------------------------------------------
create policy channel_connections_ingest_select on public.channel_connections
  for select to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on' and status = 'active');

create policy channel_connections_ingest_update on public.channel_connections
  for update to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on' and status = 'active')
  with check (current_setting('app.channel_ingest', true) = 'on' and status = 'active');

create policy channel_routes_ingest_select on public.channel_routes
  for select to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on' and status = 'active');

create policy channel_conversations_ingest_select on public.channel_conversations
  for select to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on');

create policy channel_conversations_ingest_insert on public.channel_conversations
  for insert to app_rls_helper
  with check (current_setting('app.channel_ingest', true) = 'on');

create policy channel_conversations_ingest_update on public.channel_conversations
  for update to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on')
  with check (current_setting('app.channel_ingest', true) = 'on');

create policy channel_inbound_events_ingest_select on public.channel_inbound_events
  for select to app_rls_helper
  using (current_setting('app.channel_ingest', true) = 'on');

create policy channel_inbound_events_ingest_insert on public.channel_inbound_events
  for insert to app_rls_helper
  with check (current_setting('app.channel_ingest', true) = 'on');

grant select (id, organization_id, workspace_id, kind, status, webhook_token_hash)
  on public.channel_connections to app_rls_helper;
grant update (last_event_at) on public.channel_connections to app_rls_helper;
grant select (id, connection_id, scope, status) on public.channel_routes to app_rls_helper;
grant select, insert on public.channel_conversations to app_rls_helper;
grant update (external_contact_id, external_status, last_event_at)
  on public.channel_conversations to app_rls_helper;
grant select, insert on public.channel_inbound_events to app_rls_helper;

-- The kind of an active connection whose webhook token has this hash.
create function private.channel_webhook_connection(p_connection_id uuid, p_token_hash text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.channel_ingest', true);
  v_kind text;
begin
  perform set_config('app.channel_ingest', 'on', true);
  select connection.kind into v_kind
  from public.channel_connections connection
  where connection.id = p_connection_id
    and connection.webhook_token_hash = p_token_hash
    and connection.status = 'active';
  perform set_config('app.channel_ingest', coalesce(v_previous, ''), true);
  return v_kind;
end;
$$;

-- Writes the normalized events of one webhook call. Each element of
-- p_events: { externalId, kind, sender, scope, occurredAt?,
-- conversation: { externalId, contactId?, status? }, ...rest of the event }.
-- Returns how many were stored and how many were already there; nothing
-- when the token does not match an active connection.
create function private.channel_ingest(p_connection_id uuid, p_token_hash text, p_events jsonb)
returns table(stored integer, duplicates integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.channel_ingest', true);
  v_connection public.channel_connections%rowtype;
  v_event jsonb;
  v_conversation_id uuid;
  v_routed boolean;
  v_id uuid;
  v_stored integer := 0;
  v_duplicates integer := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'channel_ingest: events must be an array' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.channel_ingest', 'on', true);
  select connection.id, connection.organization_id, connection.workspace_id
    into v_connection.id, v_connection.organization_id, v_connection.workspace_id
  from public.channel_connections connection
  where connection.id = p_connection_id
    and connection.webhook_token_hash = p_token_hash
    and connection.status = 'active';
  if v_connection.id is null then
    perform set_config('app.channel_ingest', coalesce(v_previous, ''), true);
    return;
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    v_conversation_id := null;
    if v_event->'conversation'->>'externalId' is not null then
      insert into public.channel_conversations as conversation
        (organization_id, workspace_id, connection_id, scope, external_id,
         external_contact_id, external_status)
      values
        (v_connection.organization_id, v_connection.workspace_id, v_connection.id,
         v_event->>'scope', v_event->'conversation'->>'externalId',
         v_event->'conversation'->>'contactId', v_event->'conversation'->>'status')
      on conflict (connection_id, external_id) do update
        set external_contact_id = coalesce(excluded.external_contact_id, conversation.external_contact_id),
            external_status = coalesce(excluded.external_status, conversation.external_status),
            last_event_at = now()
      returning conversation.id into v_conversation_id;
    end if;

    v_routed := exists (
      select 1 from public.channel_routes route
      where route.connection_id = v_connection.id
        and route.scope = v_event->>'scope'
        and route.status = 'active'
    );

    v_id := null;
    insert into public.channel_inbound_events
      (organization_id, workspace_id, connection_id, conversation_id, external_id,
       contract_version, kind, sender, scope, payload, status, occurred_at)
    values
      (v_connection.organization_id, v_connection.workspace_id, v_connection.id,
       v_conversation_id, v_event->>'externalId',
       coalesce((v_event->>'contractVersion')::integer, 1),
       v_event->>'kind', v_event->>'sender', v_event->>'scope', v_event,
       case when v_routed then 'routed' else 'no_route' end,
       (v_event->>'occurredAt')::timestamptz)
    on conflict (connection_id, external_id) do nothing
    returning id into v_id;
    if v_id is null then
      v_duplicates := v_duplicates + 1;
    else
      v_stored := v_stored + 1;
    end if;
  end loop;

  update public.channel_connections connection
  set last_event_at = now()
  where connection.id = v_connection.id;
  perform set_config('app.channel_ingest', coalesce(v_previous, ''), true);
  return query select v_stored, v_duplicates;
end;
$$;

revoke execute on function private.channel_webhook_connection(uuid, text) from public, anon, authenticated;
revoke execute on function private.channel_ingest(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.channel_webhook_connection(uuid, text) to app_runtime;
grant execute on function private.channel_ingest(uuid, text, jsonb) to app_runtime;
alter function private.channel_webhook_connection(uuid, text) owner to app_rls_helper;
alter function private.channel_ingest(uuid, text, jsonb) owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 4. Purge of a deleted workspace (F3e)
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['channel_inbound_events', 'channel_conversations', 'channel_routes', 'channel_connections'] loop
    execute format(
      'create policy %I on public.%I for delete to app_worker using (private.workspace_purgeable(workspace_id))',
      t || '_worker_purge', t
    );
    execute format(
      'create policy %I on public.%I for select to app_worker using (private.workspace_purgeable(workspace_id))',
      t || '_worker_purge_select', t
    );
    execute format('grant select (workspace_id), delete on public.%I to app_worker', t);
  end loop;
end
$$;
