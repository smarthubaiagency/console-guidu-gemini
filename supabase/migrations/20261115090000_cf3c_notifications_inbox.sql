-- ============================================================================
-- Migration: 20261115090000_cf3c_notifications_inbox.sql
-- Module: CF3c — in-app notices (the bell) and notification preferences
--         (/mnt/project-files/configuracoes/plano-cf3.md)
--
-- Maintenance Rationale:
-- 1. `public.user_notifications`: the notices of the bell, one row per
--    person and notice. A row keeps the event, its few values (names and
--    dates, never a secret) and the link of the notice; the dashboard writes
--    the text in the reader's language when it shows it. The idempotency key
--    is the one of the delivery, so a retried job never repeats a notice.
-- 2. `public.notification_preferences`: what a person turned off, per event
--    and channel (`email`, `app`). No row means on. Essential events
--    (security, billing) ignore the rows: the application keeps the catalog
--    of events and never turns those off, and Minha conta shows them locked.
-- 3. Each person reads and marks as read only their own notices, and reads
--    and writes only their own preferences (`app.user_id` of the request,
--    `withIdentityContext`). Read is one way: `read_at` is set, never
--    cleared; nothing else of a notice changes from the dashboard.
-- 4. Notices come from platform jobs as `app_worker`. The AI key notices
--    go to workspace owners and admins the worker already knows (A2c): it
--    reads their preferences and inserts their unread notices. Billing
--    notices go to the bell of the partner's active owners through
--    `private.post_partner_notice` (security definer, app_rls_helper),
--    because the worker never reads members' users (F3c, I5).
-- 5. Retention: category `user_notifications` (off, like the others until
--    the legal rules); when on, the worker deletes read notices past it.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated;
-- the security definer function is owned by app_rls_helper.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Notices of the bell
-- ----------------------------------------------------------------------------
create table public.user_notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  event_type      text not null
                    check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(event_type) <= 80),
  data            jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),
  link_url        text
                    check (link_url is null or (link_url ~ '^https?://[^\s<>"''`\\]+$' and length(link_url) <= 2000)),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index user_notifications_user_idx
  on public.user_notifications (user_id, created_at desc);
create index user_notifications_unread_idx
  on public.user_notifications (user_id) where read_at is null;

alter table public.user_notifications owner to app_migrations;
revoke all on public.user_notifications from public, anon, authenticated;
alter table public.user_notifications enable row level security;
alter table public.user_notifications force row level security;

create policy user_notifications_select on public.user_notifications
  for select to app_runtime
  using (user_id = private.context_uuid('app.user_id'));

create policy user_notifications_update on public.user_notifications
  for update to app_runtime
  using (user_id = private.context_uuid('app.user_id'))
  with check (user_id = private.context_uuid('app.user_id') and read_at is not null);

grant select on public.user_notifications to app_runtime;
grant update (read_at) on public.user_notifications to app_runtime;

create policy user_notifications_worker_insert on public.user_notifications
  for insert to app_worker
  with check (read_at is null);

-- `on conflict (idempotency_key)` reads the key of the row already there:
-- the worker sees the keys (as it sees deliveries), never who or what.
create policy user_notifications_worker_select on public.user_notifications
  for select to app_worker
  using (true);

grant insert, select (idempotency_key, read_at, created_at) on public.user_notifications to app_worker;

-- ----------------------------------------------------------------------------
-- 2. Preferences per event and channel
-- ----------------------------------------------------------------------------
create table public.notification_preferences (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  event_type  text not null
                check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(event_type) <= 80),
  channel     text not null check (channel in ('email', 'app')),
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, event_type, channel)
);

alter table public.notification_preferences owner to app_migrations;
revoke all on public.notification_preferences from public, anon, authenticated;
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function private.touch_updated_at();

create policy notification_preferences_select on public.notification_preferences
  for select to app_runtime
  using (user_id = private.context_uuid('app.user_id'));

create policy notification_preferences_insert on public.notification_preferences
  for insert to app_runtime
  with check (user_id = private.context_uuid('app.user_id'));

create policy notification_preferences_update on public.notification_preferences
  for update to app_runtime
  using (user_id = private.context_uuid('app.user_id'))
  with check (user_id = private.context_uuid('app.user_id'));

create policy notification_preferences_delete on public.notification_preferences
  for delete to app_runtime
  using (user_id = private.context_uuid('app.user_id'));

-- The person, event and channel of a row never change.
grant select, insert, delete on public.notification_preferences to app_runtime;
grant update (enabled, updated_at) on public.notification_preferences to app_runtime;

create policy notification_preferences_worker_select on public.notification_preferences
  for select to app_worker
  using (true);

grant select on public.notification_preferences to app_worker;

-- ----------------------------------------------------------------------------
-- 3. The bell of the partner owners for billing notices
-- ----------------------------------------------------------------------------
-- The worker never reads who the members are (F3c, I5). The notice of a
-- partner goes to the bell of its active owners through
-- `private.post_partner_notice`, which inserts it for each owner whose
-- preference allows it and answers only how many notices it wrote. The
-- helper reads the owners and their preferences only while the function
-- sets `app.notice_partner_id`, restored right after (I5 pattern).
create policy partner_members_notice_helper_select on public.partner_members
  for select to app_rls_helper
  using (
    role = 'partner_owner'
    and status = 'active'
    and partner_id = nullif(current_setting('app.notice_partner_id', true), '')::uuid
  );

create policy notification_preferences_notice_helper_select on public.notification_preferences
  for select to app_rls_helper
  using (
    channel = 'app'
    and exists (
      select 1 from public.partner_members m
      where m.user_id = notification_preferences.user_id
        and m.role = 'partner_owner'
        and m.status = 'active'
        and m.partner_id = nullif(current_setting('app.notice_partner_id', true), '')::uuid
    )
  );

create policy user_notifications_notice_helper_insert on public.user_notifications
  for insert to app_rls_helper
  with check (
    read_at is null
    and nullif(current_setting('app.notice_partner_id', true), '') is not null
  );

grant select on public.notification_preferences to app_rls_helper;
create policy user_notifications_notice_helper_select on public.user_notifications
  for select to app_rls_helper
  using (
    exists (
      select 1 from public.partner_members m
      where m.user_id = user_notifications.user_id
        and m.role = 'partner_owner'
        and m.status = 'active'
        and m.partner_id = nullif(current_setting('app.notice_partner_id', true), '')::uuid
    )
  );

grant insert, select (idempotency_key, user_id) on public.user_notifications to app_rls_helper;

create function private.post_partner_notice(
  p_partner_id uuid,
  p_event_type text,
  p_data jsonb,
  p_link_url text,
  p_idempotency_key text,
  p_essential boolean
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text := current_setting('app.notice_partner_id', true);
  v_count integer := 0;
begin
  if p_partner_id is null then
    return 0;
  end if;
  perform set_config('app.notice_partner_id', p_partner_id::text, true);
  insert into public.user_notifications (user_id, event_type, data, link_url, idempotency_key)
  select m.user_id, p_event_type, coalesce(p_data, '{}'::jsonb), p_link_url,
         p_idempotency_key || ':' || m.user_id::text
  from public.partner_members m
  where m.partner_id = p_partner_id
    and m.role = 'partner_owner'
    and m.status = 'active'
    and (
      p_essential
      or not exists (
        select 1 from public.notification_preferences p
        where p.user_id = m.user_id
          and p.event_type = p_event_type
          and p.channel = 'app'
          and not p.enabled
      )
    )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  -- The partner does not outlive the call (an error aborts the transaction
  -- or savepoint, which undoes it as well).
  perform set_config('app.notice_partner_id', coalesce(v_previous, ''), true);
  return v_count;
end;
$$;

revoke execute on function private.post_partner_notice(uuid, text, jsonb, text, text, boolean)
  from public, anon, authenticated;
grant execute on function private.post_partner_notice(uuid, text, jsonb, text, text, boolean)
  to app_worker;
alter function private.post_partner_notice(uuid, text, jsonb, text, text, boolean)
  owner to app_rls_helper;

-- ----------------------------------------------------------------------------
-- 4. Retention (off until the legal rules)
-- ----------------------------------------------------------------------------
-- The owner is bound by FORCE RLS too; lifted only for this insert.
alter table public.retention_policies no force row level security;
insert into public.retention_policies (category, description, automated) values
  ('user_notifications', 'Avisos do sino já lidos.', true);
alter table public.retention_policies force row level security;

create policy user_notifications_worker_retention on public.user_notifications
  for delete to app_worker
  using (
    read_at is not null
    and created_at < now() - make_interval(days => private.retention_days('user_notifications'))
  );

grant delete on public.user_notifications to app_worker;
