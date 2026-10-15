-- ============================================================================
-- SQL in-app notices and preferences (CF3c): `public.user_notifications`,
-- `public.notification_preferences` and `private.post_partner_notice`.
--   people: a…031 (user A), a…032 (user B)
--   partner (per block) c3c…001: d…006 and d…007 owners, d…004 support,
--   d…008 inactive owner; another partner c3c…002 with owner d…005
-- Each block prepares its fixtures as administrator, switches role with
-- `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid)
returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.workspace_id', '', true),
         set_config('app.organization_id', '', true),
         set_config('app.partner_id', '', true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.user_notifications (id, user_id, event_type, data, link_url, idempotency_key) values
    ('c3c00000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000031',
     'ai.agent.key_backup', '{"workspace": "A"}', 'https://a.test/x', 'cf3c:a1'),
    ('c3c00000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-000000000031',
     'ai.agent.key_paused', '{"workspace": "A"}', null, 'cf3c:a2'),
    ('c3c00000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000032',
     'ai.agent.key_backup', '{"workspace": "B"}', null, 'cf3c:b1');
  insert into public.notification_preferences (user_id, event_type, channel, enabled) values
    ('a0000000-0000-4000-8000-000000000032', 'ai.agent.key_backup', 'email', false);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: a person reads and marks as read only their own notices
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  if (select count(*) from public.user_notifications) <> 2 then
    raise exception 'user_notifications: owner does not see exactly their notices';
  end if;
  if (select count(*) from public.user_notifications where read_at is null) <> 2 then
    raise exception 'user_notifications: unread count wrong';
  end if;

  update public.user_notifications set read_at = now()
  where id = 'c3c00000-0000-4000-8000-0000000000a1';
  if not found then raise exception 'user_notifications: owner could not mark as read'; end if;

  -- Someone else's notice is not reached.
  update public.user_notifications set read_at = now()
  where id = 'c3c00000-0000-4000-8000-0000000000b1';
  if found then raise exception 'user_notifications: marked another person''s notice'; end if;

  -- Read is one way, and nothing else of a notice changes.
  begin
    update public.user_notifications set read_at = null
    where id = 'c3c00000-0000-4000-8000-0000000000a1';
    raise exception 'user_notifications: notice marked as unread';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_notifications set link_url = 'https://evil.test';
    raise exception 'user_notifications: link changed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_notifications set user_id = 'a0000000-0000-4000-8000-000000000032';
    raise exception 'user_notifications: notice moved to another person';
  exception when insufficient_privilege then null;
  end;
  -- The dashboard neither creates nor deletes notices.
  begin
    insert into public.user_notifications (user_id, event_type, idempotency_key)
    values ('a0000000-0000-4000-8000-000000000031', 'ai.agent.key_backup', 'cf3c:x');
    raise exception 'user_notifications: dashboard inserted a notice';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.user_notifications;
    raise exception 'user_notifications: dashboard deleted a notice';
  exception when insufficient_privilege then null;
  end;

  -- Without a person in the context nothing is visible.
  perform pg_temp.ctx(null);
  if exists (select 1 from public.user_notifications) then
    raise exception 'user_notifications: visible without a person';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032');
  if (select count(*) from public.user_notifications) <> 1 then
    raise exception 'user_notifications: user B does not see exactly their notice';
  end if;
  -- "Mark all" reaches only the person's own notices.
  update public.user_notifications set read_at = now() where read_at is null;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.user_notifications where read_at is null) <> 1 then
    raise exception 'user_notifications: mark all crossed people';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: preferences are the person's own
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031');
  if exists (select 1 from public.notification_preferences) then
    raise exception 'notification_preferences: reads another person''s rows';
  end if;
  insert into public.notification_preferences (user_id, event_type, channel, enabled)
  values ('a0000000-0000-4000-8000-000000000031', 'ai.agent.key_backup', 'app', false);
  update public.notification_preferences set enabled = true;
  if not found then raise exception 'notification_preferences: own row not updated'; end if;

  begin
    insert into public.notification_preferences (user_id, event_type, channel, enabled)
    values ('a0000000-0000-4000-8000-000000000032', 'ai.agent.key_backup', 'app', false);
    raise exception 'notification_preferences: wrote another person''s preference';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.notification_preferences set channel = 'email';
    raise exception 'notification_preferences: channel changed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notification_preferences (user_id, event_type, channel, enabled)
    values ('a0000000-0000-4000-8000-000000000031', 'ai.agent.key_backup', 'sms', false);
    raise exception 'notification_preferences: unknown channel saved';
  exception when check_violation then null;
  end;

  delete from public.notification_preferences;
  if not found then raise exception 'notification_preferences: own row not deleted'; end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.notification_preferences
      where user_id = 'a0000000-0000-4000-8000-000000000032') <> 1 then
    raise exception 'notification_preferences: another person''s row changed';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the worker inserts unread notices and reads preferences only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_worker;
do $$
begin
  insert into public.user_notifications (user_id, event_type, data, idempotency_key)
  values ('a0000000-0000-4000-8000-000000000031', 'ai.agent.key_backup', '{}', 'cf3c:w1');
  -- The same key again is a no-op.
  insert into public.user_notifications (user_id, event_type, data, idempotency_key)
  values ('a0000000-0000-4000-8000-000000000031', 'ai.agent.key_backup', '{}', 'cf3c:w1')
  on conflict (idempotency_key) do nothing;
  begin
    insert into public.user_notifications (user_id, event_type, data, idempotency_key, read_at)
    values ('a0000000-0000-4000-8000-000000000031', 'ai.agent.key_backup', '{}', 'cf3c:w2', now());
    raise exception 'user_notifications: worker inserted a read notice';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_notifications (user_id, event_type, data, idempotency_key, link_url)
    values ('a0000000-0000-4000-8000-000000000031', 'ai.agent.key_backup', '{}', 'cf3c:w3',
            'javascript:alert(1)');
    raise exception 'user_notifications: unsafe link saved';
  exception when check_violation then null;
  end;
  -- The worker sees the keys only, never who or what.
  begin
    perform data from public.user_notifications;
    raise exception 'user_notifications: worker reads notice data';
  exception when insufficient_privilege then null;
  end;
  begin
    perform user_id from public.user_notifications;
    raise exception 'user_notifications: worker reads notice people';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_notifications set read_at = now();
    raise exception 'user_notifications: worker marked a notice';
  exception when insufficient_privilege then null;
  end;
  delete from public.user_notifications;
  if found then raise exception 'user_notifications: worker deleted notices with retention off'; end if;

  if (select count(*) from public.notification_preferences) <> 1 then
    raise exception 'notification_preferences: worker cannot read preferences';
  end if;
  begin
    insert into public.notification_preferences (user_id, event_type, channel, enabled)
    values ('a0000000-0000-4000-8000-000000000031', 'ai.agent.key_backup', 'app', false);
    raise exception 'notification_preferences: worker wrote a preference';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.user_notifications where idempotency_key = 'cf3c:w1') <> 1 then
    raise exception 'user_notifications: worker notice missing or repeated';
  end if;
  if not exists (select 1 from public.retention_policies
                 where category = 'user_notifications' and not enabled) then
    raise exception 'retention: user_notifications category missing or enabled';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: `private.post_partner_notice` reaches the active owners of the
-- partner, respects their preference unless essential, and runs once per key
-- ----------------------------------------------------------------------------
begin;
insert into public.partners (id, slug, name) values
  ('c3c00000-0000-4000-8000-000000000001', 'agencia-cf3c', 'Agência CF3c'),
  ('c3c00000-0000-4000-8000-000000000002', 'outra-cf3c', 'Outra CF3c');
insert into public.partner_members (partner_id, user_id, email, role, status) values
  ('c3c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'dono1@cf3c.test', 'partner_owner', 'active'),
  ('c3c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000007', 'dono2@cf3c.test', 'partner_owner', 'active'),
  ('c3c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'sup@cf3c.test', 'partner_support', 'active'),
  ('c3c00000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000008', 'ex@cf3c.test', 'partner_owner', 'inactive'),
  ('c3c00000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'dono@outra.test', 'partner_owner', 'active');
insert into public.notification_preferences (user_id, event_type, channel, enabled) values
  ('d0000000-0000-4000-8000-000000000007', 'billing.subscription.past_due', 'app', false);

set local role app_worker;
do $$
declare
  v integer;
begin
  -- Optional: the owner who turned the bell off is skipped.
  v := private.post_partner_notice('c3c00000-0000-4000-8000-000000000001',
         'billing.subscription.past_due', '{"organization": "Cliente"}',
         'https://cf3c.test/admin/billing', 'cf3c:p1', false);
  if v <> 1 then raise exception 'post_partner_notice: optional reached % owners', v; end if;
  -- Essential: every active owner, whatever the preference.
  v := private.post_partner_notice('c3c00000-0000-4000-8000-000000000001',
         'billing.subscription.past_due', '{}', null, 'cf3c:p2', true);
  if v <> 2 then raise exception 'post_partner_notice: essential reached % owners', v; end if;
  -- Again with the same key: nothing new.
  v := private.post_partner_notice('c3c00000-0000-4000-8000-000000000001',
         'billing.subscription.past_due', '{}', null, 'cf3c:p2', true);
  if v <> 0 then raise exception 'post_partner_notice: repeated % notices', v; end if;
  if coalesce(current_setting('app.notice_partner_id', true), '') <> '' then
    raise exception 'post_partner_notice: partner outlived the call';
  end if;
  -- The worker still learns nothing of the members.
  begin
    perform user_id from public.partner_members;
    raise exception 'post_partner_notice: worker reads member users';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
begin
  if (select count(*) from public.user_notifications where idempotency_key like 'cf3c:p%') <> 3 then
    raise exception 'post_partner_notice: wrong number of notices';
  end if;
  if exists (select 1 from public.user_notifications
             where idempotency_key like 'cf3c:p%'
               and user_id not in ('d0000000-0000-4000-8000-000000000006',
                                   'd0000000-0000-4000-8000-000000000007')) then
    raise exception 'post_partner_notice: notice for someone who is not an active owner';
  end if;
end $$;

-- The helper reads no owner and no preference outside the function.
set local role app_rls_helper;
do $$
begin
  perform set_config('app.user_id', '', true);
  if exists (select 1 from public.partner_members where role = 'partner_owner') then
    raise exception 'post_partner_notice: helper reads owners outside the call';
  end if;
  if exists (select 1 from public.notification_preferences) then
    raise exception 'post_partner_notice: helper reads preferences outside the call';
  end if;
end $$;
reset role;

-- Only the worker calls it.
set local role app_runtime;
do $$
begin
  perform private.post_partner_notice('c3c00000-0000-4000-8000-000000000001',
            'billing.subscription.past_due', '{}', null, 'cf3c:r', true);
  raise exception 'post_partner_notice: dashboard called it';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role authenticated;
do $$
begin
  perform private.post_partner_notice('c3c00000-0000-4000-8000-000000000001',
            'billing.subscription.past_due', '{}', null, 'cf3c:a', true);
  raise exception 'post_partner_notice: authenticated called it';
exception when insufficient_privilege then null;
end $$;
reset role;
rollback;

-- ----------------------------------------------------------------------------
-- Test 5: nobody outside the application roles reaches the tables
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.user_notifications;
    raise exception 'user_notifications: authenticated reads';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.notification_preferences;
    raise exception 'notification_preferences: authenticated reads';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if not (select relforcerowsecurity and relrowsecurity from pg_class
          where oid = 'public.user_notifications'::regclass) then
    raise exception 'user_notifications: RLS not forced';
  end if;
  if not (select relforcerowsecurity and relrowsecurity from pg_class
          where oid = 'public.notification_preferences'::regclass) then
    raise exception 'notification_preferences: RLS not forced';
  end if;
end $$;
rollback;
