-- ============================================================================
-- SQL e-mail templates (CF3b): `public.email_templates` and
-- `private.email_template(partner, event, locale)`.
--   platform: d…003 owner, d…002 billing (per block)
--   partner B b8…001 (per block): d…006 partner_admin, d…004 partner_support
--   another partner b8…002
--   customer: a…033 (viewer of workspace A)
-- Each block prepares its fixtures as administrator, switches role with
-- `set local role` and rolls back.
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_partner uuid default null)
returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', '', true),
         set_config('app.organization_id', '', true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true);
$$;

create or replace function pg_temp.fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('b8000000-0000-4000-8000-000000000001', 'agencia-cf3b', 'Agência CF3b'),
    ('b8000000-0000-4000-8000-000000000002', 'outra-cf3b', 'Outra CF3b');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b8000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'admin@cf3b.test', 'partner_admin'),
    ('b8000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'sup@cf3b.test', 'partner_support');
  insert into public.platform_admin_members (user_id, role, status)
  values ('d0000000-0000-4000-8000-000000000002', 'billing', 'active')
  on conflict (user_id) do update set role = 'billing', status = 'active';
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the platform base is written by platform owner and operations only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003');
  insert into public.email_templates (scope, event_type, locale, subject, body, updated_by)
  values ('platform', 'email.test', 'pt-BR', 'Teste {{marca}}', 'Olá',
          'd0000000-0000-4000-8000-000000000003');
  update public.email_templates set subject = 'Novo' where scope = 'platform';
  if not found then raise exception 'email_templates: platform owner could not edit'; end if;

  -- Event, language and scope never change after the insert.
  begin
    update public.email_templates set locale = 'en';
    raise exception 'email_templates: locale changed';
  exception when insufficient_privilege then null;
  end;
  -- A subject with a line break is refused by the table too.
  begin
    update public.email_templates set subject = E'a\nb';
    raise exception 'email_templates: multi-line subject saved';
  exception when check_violation then null;
  end;

  -- Platform billing is not a manager; it reads, never writes.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000002');
  if (select count(*) from public.email_templates) <> 1 then
    raise exception 'email_templates: platform billing cannot read';
  end if;
  begin
    insert into public.email_templates (scope, event_type, locale, subject, body, updated_by)
    values ('platform', 'email.test', 'en', 'x', 'y', 'd0000000-0000-4000-8000-000000000002');
    raise exception 'email_templates: platform billing wrote a template';
  exception when insufficient_privilege then null;
  end;
  delete from public.email_templates;
  if found then raise exception 'email_templates: platform billing deleted a template'; end if;

  -- Partner staff and customers never read the platform rows directly.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006',
                      'b8000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.email_templates) then
    raise exception 'email_templates: partner reads the platform table rows';
  end if;
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033');
  if exists (select 1 from public.email_templates) then
    raise exception 'email_templates: customer reads the table';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: a partner's templates are written by its owner and admin only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006',
                      'b8000000-0000-4000-8000-000000000001');
  insert into public.email_templates (scope, partner_id, event_type, locale, subject, body, updated_by)
  values ('partner', 'b8000000-0000-4000-8000-000000000001', 'invitation.created', 'pt-BR',
          'Convite', 'Olá', 'd0000000-0000-4000-8000-000000000006');

  -- Another partner's template, a platform row, or one signed as someone
  -- else is refused.
  begin
    insert into public.email_templates (scope, partner_id, event_type, locale, subject, body, updated_by)
    values ('partner', 'b8000000-0000-4000-8000-000000000002', 'invitation.created', 'pt-BR',
            'x', 'y', 'd0000000-0000-4000-8000-000000000006');
    raise exception 'email_templates: template of another partner written';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.email_templates (scope, event_type, locale, subject, body, updated_by)
    values ('platform', 'invitation.created', 'en', 'x', 'y', 'd0000000-0000-4000-8000-000000000006');
    raise exception 'email_templates: partner wrote the platform base';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.email_templates set updated_by = 'd0000000-0000-4000-8000-000000000004';
    raise exception 'email_templates: signed as someone else';
  exception when insufficient_privilege then null;
  end;

  -- Support reads the partner's templates but does not change them.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004',
                      'b8000000-0000-4000-8000-000000000001');
  if (select count(*) from public.email_templates) <> 1 then
    raise exception 'email_templates: partner support cannot read';
  end if;
  update public.email_templates set subject = 'x';
  if found then raise exception 'email_templates: partner support edited a template'; end if;
  delete from public.email_templates;
  if found then raise exception 'email_templates: partner support deleted a template'; end if;

  -- The other partner sees nothing.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006',
                      'b8000000-0000-4000-8000-000000000002');
  if exists (select 1 from public.email_templates) then
    raise exception 'email_templates: another partner reads the template';
  end if;
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: `private.email_template` returns the partner's row, else the
-- platform's, to the dashboard and the worker; never to anon/authenticated
-- ----------------------------------------------------------------------------
begin;
select pg_temp.fixture();
insert into public.email_templates (scope, event_type, locale, subject, body, updated_by) values
  ('platform', 'invitation.created', 'pt-BR', 'Base', 'b', 'd0000000-0000-4000-8000-000000000003'),
  ('platform', 'email.test', 'pt-BR', 'Teste base', 'b', 'd0000000-0000-4000-8000-000000000003');
insert into public.email_templates (scope, partner_id, event_type, locale, subject, body, updated_by) values
  ('partner', 'b8000000-0000-4000-8000-000000000001', 'invitation.created', 'pt-BR', 'Parceiro', 'p',
   'd0000000-0000-4000-8000-000000000006'),
  ('partner', 'b8000000-0000-4000-8000-000000000002', 'email.test', 'pt-BR', 'Outra', 'o',
   'd0000000-0000-4000-8000-000000000006');

set local role app_runtime;
do $$
begin
  -- A request with no context at all (an invitation on any host).
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033');
  if (select scope || ':' || subject from private.email_template(
        'b8000000-0000-4000-8000-000000000001', 'invitation.created', 'pt-BR'))
     is distinct from 'partner:Parceiro' then
    raise exception 'email_template: partner override missing';
  end if;
  if (select scope || ':' || subject from private.email_template(
        'b8000000-0000-4000-8000-000000000001', 'email.test', 'pt-BR'))
     is distinct from 'platform:Teste base' then
    raise exception 'email_template: platform fallback missing';
  end if;
  if (select subject from private.email_template(null, 'invitation.created', 'pt-BR'))
     is distinct from 'Base' then
    raise exception 'email_template: platform row without partner missing';
  end if;
  if exists (select 1 from private.email_template(
        'b8000000-0000-4000-8000-000000000001', 'invitation.created', 'en')) then
    raise exception 'email_template: another language returned';
  end if;
  if exists (select 1 from public.email_templates) then
    raise exception 'email_template: customer reads the table';
  end if;
end $$;
reset role;

set local role app_worker;
do $$
begin
  if (select subject from private.email_template(
        'b8000000-0000-4000-8000-000000000002', 'email.test', 'pt-BR'))
     is distinct from 'Outra' then
    raise exception 'email_template: worker misses the partner row';
  end if;
end $$;
reset role;

set local role authenticated;
do $$
begin
  perform private.email_template(null, 'email.test', 'pt-BR');
  raise exception 'email_template: authenticated called it';
exception when insufficient_privilege then null;
end $$;
rollback;
