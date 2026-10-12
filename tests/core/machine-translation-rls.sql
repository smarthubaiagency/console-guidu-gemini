-- ============================================================================
-- SQL machine translation RLS (I6, ADR 0013)
-- Tables: job_runs (platform runs i18n.translate-texts and
-- legal.translate-document), platform_translations,
-- partner_legal_documents, partner_legal_document_translations
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches role with `set local role` and rolls back.
-- Fixtures: tests/core/seed.sql, membership-seed.sql, admin-seed.sql.
--   d…003 platform owner (house partner 00000000-…-000000000000)
--   a…031 owner of workspace A (no platform role)
--   partner B b0000000-0000-4000-8000-000000000001: d…004 partner_owner,
--   d…005 partner_finance; partner C b0000000-0000-4000-8000-000000000002:
--   d…006 partner_owner
--   document e…001 (terms v1 of partner B, original in pt-BR)
-- ============================================================================

create or replace function pg_temp.mt_fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B'),
    ('b0000000-0000-4000-8000-000000000002', 'agencia-c', 'Agência C');
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@b.test', 'partner_owner'),
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'fin@b.test', 'partner_finance'),
    ('b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000006', 'owner@c.test', 'partner_owner');
  insert into public.partner_legal_documents (id, partner_id, kind, version, title, body, published_by)
  values ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
          'terms', 1, 'Termos', 'Texto', 'd0000000-0000-4000-8000-000000000004');
  insert into public.platform_languages (code, name) values ('fr', 'Français');
$$;

create or replace function pg_temp.ctx(p_user uuid, p_partner uuid) returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.partner_id', coalesce(p_partner::text, ''), true),
         set_config('app.workspace_id', '', true),
         set_config('app.organization_id', '', true);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the platform owner asks for a texts run; others cannot
-- ----------------------------------------------------------------------------
begin;
select pg_temp.mt_fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null);
  insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
  values ('i18n.translate-texts', 'platform', 'd0000000-0000-4000-8000-000000000003',
          '{"locale": "fr", "requestedBy": "d0000000-0000-4000-8000-000000000003"}', 'mt-1');
  if (select count(*) from public.job_runs where idempotency_key = 'mt-1') <> 1 then
    raise exception 'machine: platform owner cannot read the run it asked for';
  end if;
  -- Unknown language.
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('i18n.translate-texts', 'platform', 'd0000000-0000-4000-8000-000000000003',
            '{"locale": "xx", "requestedBy": "d0000000-0000-4000-8000-000000000003"}', 'mt-2');
    raise exception 'machine: run for an unknown language';
  exception when insufficient_privilege then null;
  end;
  -- Forged requester (column or payload).
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('i18n.translate-texts', 'platform', 'a0000000-0000-4000-8000-000000000031',
            '{"locale": "fr", "requestedBy": "a0000000-0000-4000-8000-000000000031"}', 'mt-3');
    raise exception 'machine: requested_by forged';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('i18n.translate-texts', 'platform', 'd0000000-0000-4000-8000-000000000003',
            '{"locale": "fr", "requestedBy": "a0000000-0000-4000-8000-000000000031"}', 'mt-4');
    raise exception 'machine: payload requester forged';
  exception when insufficient_privilege then null;
  end;
  -- Born pending only.
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key, status)
    values ('i18n.translate-texts', 'platform', 'd0000000-0000-4000-8000-000000000003',
            '{"locale": "fr", "requestedBy": "d0000000-0000-4000-8000-000000000003"}', 'mt-5', 'running');
    raise exception 'machine: run born running';
  exception when insufficient_privilege then null;
  end;
  -- Any other platform kind stays closed.
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('billing.daily-transitions', 'platform', 'd0000000-0000-4000-8000-000000000003',
            '{"requestedBy": "d0000000-0000-4000-8000-000000000003"}', 'mt-6');
    raise exception 'machine: other platform job enqueued from the web';
  exception when insufficient_privilege then null;
  end;

  -- A workspace member without a platform role cannot.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', null);
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('i18n.translate-texts', 'platform', 'a0000000-0000-4000-8000-000000000031',
            '{"locale": "fr", "requestedBy": "a0000000-0000-4000-8000-000000000031"}', 'mt-7');
    raise exception 'machine: workspace member enqueued a texts run';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.job_runs where scope = 'platform') then
    raise exception 'machine: workspace member reads platform runs';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: partner publishers ask for a document run of their partner only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.mt_fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001');
  insert into public.job_runs (kind, scope, partner_id, requested_by, payload, idempotency_key)
  values ('legal.translate-document', 'platform', 'b0000000-0000-4000-8000-000000000001',
          'd0000000-0000-4000-8000-000000000004',
          '{"documentId": "e0000000-0000-4000-8000-000000000001", "partnerId": "b0000000-0000-4000-8000-000000000001", "requestedBy": "d0000000-0000-4000-8000-000000000004"}',
          'mt-legal-1');
  if (select count(*) from public.job_runs where kind = 'legal.translate-document') <> 1 then
    raise exception 'machine: publisher cannot read the legal run';
  end if;
  -- Not a texts run.
  begin
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key)
    values ('i18n.translate-texts', 'platform', 'd0000000-0000-4000-8000-000000000004',
            '{"locale": "fr", "requestedBy": "d0000000-0000-4000-8000-000000000004"}', 'mt-legal-2');
    raise exception 'machine: partner owner enqueued a texts run';
  exception when insufficient_privilege then null;
  end;

  -- partner_finance does not publish.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001');
  begin
    insert into public.job_runs (kind, scope, partner_id, requested_by, payload, idempotency_key)
    values ('legal.translate-document', 'platform', 'b0000000-0000-4000-8000-000000000001',
            'd0000000-0000-4000-8000-000000000005',
            '{"documentId": "e0000000-0000-4000-8000-000000000001", "partnerId": "b0000000-0000-4000-8000-000000000001", "requestedBy": "d0000000-0000-4000-8000-000000000005"}',
            'mt-legal-3');
    raise exception 'machine: partner_finance enqueued a legal run';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.job_runs where kind = 'legal.translate-document') then
    raise exception 'machine: partner_finance reads legal runs';
  end if;

  -- Owner of partner C: neither in its own context nor in B's.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000002');
  begin
    insert into public.job_runs (kind, scope, partner_id, requested_by, payload, idempotency_key)
    values ('legal.translate-document', 'platform', 'b0000000-0000-4000-8000-000000000002',
            'd0000000-0000-4000-8000-000000000006',
            '{"documentId": "e0000000-0000-4000-8000-000000000001", "partnerId": "b0000000-0000-4000-8000-000000000002", "requestedBy": "d0000000-0000-4000-8000-000000000006"}',
            'mt-legal-4');
    raise exception 'machine: another partner enqueued a run for a foreign document';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.job_runs where kind = 'legal.translate-document') then
    raise exception 'machine: legal run visible to another partner';
  end if;
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001');
  begin
    insert into public.job_runs (kind, scope, partner_id, requested_by, payload, idempotency_key)
    values ('legal.translate-document', 'platform', 'b0000000-0000-4000-8000-000000000001',
            'd0000000-0000-4000-8000-000000000006',
            '{"documentId": "e0000000-0000-4000-8000-000000000001", "partnerId": "b0000000-0000-4000-8000-000000000001", "requestedBy": "d0000000-0000-4000-8000-000000000006"}',
            'mt-legal-5');
    raise exception 'machine: non-member enqueued in another partner''s context';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the worker inserts machine texts during a running run only, never
-- manual ones, never over an existing row; no update or delete
-- ----------------------------------------------------------------------------
begin;
select pg_temp.mt_fixture();
insert into public.platform_translations (locale, key, value, origin, updated_by)
values ('fr', 'nav.manual', 'Manuel', 'manual', 'd0000000-0000-4000-8000-000000000003');
set local role app_worker;
do $$
declare
  n integer;
begin
  -- Without a running run the worker neither reads nor writes the texts.
  if exists (select 1 from public.platform_translations) then
    raise exception 'machine: worker reads texts outside a run';
  end if;
  begin
    insert into public.platform_translations (locale, key, value, origin)
    values ('fr', 'nav.other', 'Autre', 'machine');
    raise exception 'machine: worker wrote outside a run';
  exception when insufficient_privilege then null;
  end;

  insert into public.job_runs (kind, scope, payload, idempotency_key)
  values ('i18n.translate-texts', 'platform',
          '{"locale": "fr", "requestedBy": "d0000000-0000-4000-8000-000000000003"}', 'mt-w-1');
  update public.job_runs set status = 'running' where idempotency_key = 'mt-w-1';

  if (select count(*) from public.platform_translations where locale = 'fr') <> 1 then
    raise exception 'machine: worker cannot read the keys of the running language';
  end if;
  if (select count(*) from public.platform_languages) < 4 then
    raise exception 'machine: worker cannot read the languages';
  end if;
  insert into public.platform_translations (locale, key, value, origin)
  values ('fr', 'nav.other', 'Autre', 'machine');
  -- Only the running language.
  begin
    insert into public.platform_translations (locale, key, value, origin)
    values ('en', 'nav.other', 'Other', 'machine');
    raise exception 'machine: worker wrote another language';
  exception when insufficient_privilege then null;
  end;
  -- Never manual.
  begin
    insert into public.platform_translations (locale, key, value, origin)
    values ('fr', 'nav.third', 'Troisième', 'manual');
    raise exception 'machine: worker wrote a manual text';
  exception when insufficient_privilege then null;
  end;
  -- Never with an author.
  begin
    insert into public.platform_translations (locale, key, value, origin, updated_by)
    values ('fr', 'nav.third', 'Troisième', 'machine', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'machine: worker set an author';
  exception when insufficient_privilege then null;
  end;
  -- Never over an existing row: a conflict errors, DO NOTHING skips it.
  begin
    insert into public.platform_translations (locale, key, value, origin)
    values ('fr', 'nav.manual', 'Machine', 'machine');
    raise exception 'machine: worker overwrote a manual text';
  exception when unique_violation then null;
  end;
  insert into public.platform_translations (locale, key, value, origin)
  values ('fr', 'nav.manual', 'Machine', 'machine')
  on conflict do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'machine: on conflict did not skip'; end if;
  begin
    update public.platform_translations set value = 'X' where locale = 'fr';
    raise exception 'machine: worker updated a text';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.platform_translations where locale = 'fr';
    raise exception 'machine: worker removed a text';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
do $$
begin
  if (select value from public.platform_translations where locale = 'fr' and key = 'nav.manual') <> 'Manuel'
     or (select origin from public.platform_translations where locale = 'fr' and key = 'nav.other') <> 'machine'
     or (select updated_by from public.platform_translations where locale = 'fr' and key = 'nav.other') is not null then
    raise exception 'machine: unexpected texts after the worker';
  end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: the worker translates a document during its run only
-- ----------------------------------------------------------------------------
begin;
select pg_temp.mt_fixture();
insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
values ('e0000000-0000-4000-8000-000000000001', 'en', 'Terms', 'Manual text', 'd0000000-0000-4000-8000-000000000004');
set local role app_worker;
do $$
begin
  if exists (select 1 from public.partner_legal_documents)
     or exists (select 1 from public.partner_legal_document_translations) then
    raise exception 'machine: worker reads legal documents outside a run';
  end if;
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, origin)
    values ('e0000000-0000-4000-8000-000000000001', 'es', 'Términos', 'Texto', 'machine');
    raise exception 'machine: worker translated outside a run';
  exception when insufficient_privilege then null;
  end;

  insert into public.job_runs (kind, scope, partner_id, payload, idempotency_key)
  values ('legal.translate-document', 'platform', 'b0000000-0000-4000-8000-000000000001',
          '{"documentId": "e0000000-0000-4000-8000-000000000001", "partnerId": "b0000000-0000-4000-8000-000000000001", "requestedBy": "d0000000-0000-4000-8000-000000000004"}',
          'mt-w-2');
  update public.job_runs set status = 'running' where idempotency_key = 'mt-w-2';

  if (select body from public.partner_legal_documents) <> 'Texto' then
    raise exception 'machine: worker cannot read the running document';
  end if;
  if (select count(*) from public.partner_legal_document_translations) <> 1 then
    raise exception 'machine: worker cannot read the existing translations';
  end if;
  insert into public.partner_legal_document_translations (document_id, locale, title, body, origin)
  values ('e0000000-0000-4000-8000-000000000001', 'es', 'Términos', 'Texto', 'machine');
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, origin)
    values ('e0000000-0000-4000-8000-000000000001', 'pt-BR', 'Termos', 'Texto', 'machine');
    raise exception 'machine: worker translated into the language of the original';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, origin)
    values ('e0000000-0000-4000-8000-000000000001', 'fr', 'Termes', 'Texte', 'manual');
    raise exception 'machine: worker wrote a manual translation';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, origin)
    values ('e0000000-0000-4000-8000-000000000001', 'en', 'Terms', 'Machine', 'machine');
    raise exception 'machine: worker overwrote a manual translation';
  exception when unique_violation then null;
  end;
  begin
    update public.partner_legal_document_translations set body = 'X';
    raise exception 'machine: worker updated a translation';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.partner_legal_document_translations;
    raise exception 'machine: worker removed a translation';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
do $$
begin
  if (select body from public.partner_legal_document_translations where locale = 'en') <> 'Manual text'
     or (select origin from public.partner_legal_document_translations where locale = 'es') <> 'machine' then
    raise exception 'machine: unexpected translations after the worker';
  end if;
end
$$;
rollback;
