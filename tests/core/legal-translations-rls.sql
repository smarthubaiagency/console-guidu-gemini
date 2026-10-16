-- ============================================================================
-- SQL Legal document translations RLS (I5, ADR 0013)
-- Tables: partner_legal_document_translations, partner_legal_documents.locale
--
-- Executed as migration administrator. Each block prepares its fixtures as
-- administrator, switches to `app_runtime` with `set local role` and rolls
-- back. Fixtures: tests/core/seed.sql, membership-seed.sql, admin-seed.sql.
--   partner B b0000000-0000-4000-8000-000000000001 (per block): d…004
--   partner_owner, d…005 partner_finance; org B a…020 moved to partner B,
--   userB a…032 owner of workspace B (a customer of partner B)
--   partner C b0000000-0000-4000-8000-000000000002: d…006 partner_owner
--   d…003 platform owner (house partner 00000000-…-000000000000)
--   document e…001 (terms v1 of partner B, original in pt-BR)
-- ============================================================================

create or replace function pg_temp.translation_fixture() returns void
language sql as $$
  insert into public.partners (id, slug, name) values
    ('b0000000-0000-4000-8000-000000000001', 'agencia-b', 'Agência B'),
    ('b0000000-0000-4000-8000-000000000002', 'agencia-c', 'Agência C');
  -- The management clause seeded for new partners (GB1c) stays out.
  delete from public.partner_legal_document_translations t
  using public.partner_legal_documents d
  where d.id = t.document_id and d.kind = 'management';
  insert into public.partner_members (partner_id, user_id, email, role) values
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'owner@b.test', 'partner_owner'),
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'fin@b.test', 'partner_finance'),
    ('b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000006', 'owner@c.test', 'partner_owner');
  update public.organizations
  set partner_id = 'b0000000-0000-4000-8000-000000000001'
  where id = 'a0000000-0000-4000-8000-000000000020';
  insert into public.partner_legal_documents (id, partner_id, kind, version, title, body, published_by)
  values ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
          'terms', 1, 'Termos', 'Texto', 'd0000000-0000-4000-8000-000000000004');
$$;

create or replace function pg_temp.ctx(p_user uuid, p_partner uuid) returns void
language sql as $$
  select set_config('app.user_id', coalesce(p_user::text, ''), true),
         set_config('app.partner_id', p_partner::text, true);
$$;

-- ----------------------------------------------------------------------------
-- Test 1: the partner publisher writes; readers of the partner read
-- ----------------------------------------------------------------------------
begin;
select pg_temp.translation_fixture();
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001');
  if (select locale from public.partner_legal_documents
      where id = 'e0000000-0000-4000-8000-000000000001') <> 'pt-BR' then
    raise exception 'translations: original not born in the source language';
  end if;
  insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
  values ('e0000000-0000-4000-8000-000000000001', 'en', 'Terms', 'Text', 'd0000000-0000-4000-8000-000000000004');
  update public.partner_legal_document_translations
  set body = 'Text v2', updated_by = 'd0000000-0000-4000-8000-000000000004'
  where document_id = 'e0000000-0000-4000-8000-000000000001' and locale = 'en';
  if not found then raise exception 'translations: publisher cannot update'; end if;

  -- Never in the language of the original.
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000001', 'pt-BR', 'Termos', 'Texto', 'd0000000-0000-4000-8000-000000000004');
    raise exception 'translations: translation in the language of the original';
  exception when insufficient_privilege then null;
  end;
  -- Same checks as the document.
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000001', 'es', ' ', 'Texto', 'd0000000-0000-4000-8000-000000000004');
    raise exception 'translations: blank title accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, origin, updated_by)
    values ('e0000000-0000-4000-8000-000000000001', 'es', 'Términos', 'Texto', 'robot', 'd0000000-0000-4000-8000-000000000004');
    raise exception 'translations: unknown origin accepted';
  exception when check_violation then null;
  end;
  -- Forged author.
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000001', 'es', 'Términos', 'Texto', 'd0000000-0000-4000-8000-000000000005');
    raise exception 'translations: updated_by forged on insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.partner_legal_document_translations
    set body = 'Forged', updated_by = 'd0000000-0000-4000-8000-000000000003'
    where document_id = 'e0000000-0000-4000-8000-000000000001' and locale = 'en';
    raise exception 'translations: updated_by forged on update';
  exception when insufficient_privilege then null;
  end;

  -- A customer of the partner reads (sign-in pages), without writing.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000032', 'b0000000-0000-4000-8000-000000000001');
  if (select body from public.partner_legal_document_translations where locale = 'en') <> 'Text v2' then
    raise exception 'translations: reader of the partner cannot read';
  end if;
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000001', 'es', 'Términos', 'Texto', 'a0000000-0000-4000-8000-000000000032');
    raise exception 'translations: customer wrote a translation';
  exception when insufficient_privilege then null;
  end;
  update public.partner_legal_document_translations
  set body = 'Customer', updated_by = 'a0000000-0000-4000-8000-000000000032'
  where locale = 'en';
  if found then raise exception 'translations: customer updated a translation'; end if;
  delete from public.partner_legal_document_translations where locale = 'en';
  if found then raise exception 'translations: customer removed a translation'; end if;

  -- Readers before sign-in: partner context only.
  perform pg_temp.ctx(null, 'b0000000-0000-4000-8000-000000000001');
  if (select count(*) from public.partner_legal_document_translations) <> 1 then
    raise exception 'translations: anonymous reader of the host cannot read';
  end if;

  -- partner_finance does not publish.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001');
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000001', 'es', 'Términos', 'Texto', 'd0000000-0000-4000-8000-000000000005');
    raise exception 'translations: partner_finance wrote a translation';
  exception when insufficient_privilege then null;
  end;

  -- The publisher removes the translation.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001');
  delete from public.partner_legal_document_translations
  where document_id = 'e0000000-0000-4000-8000-000000000001' and locale = 'en';
  if not found then raise exception 'translations: publisher cannot remove'; end if;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 2: another partner neither reads nor writes
-- ----------------------------------------------------------------------------
begin;
select pg_temp.translation_fixture();
insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
values ('e0000000-0000-4000-8000-000000000001', 'en', 'Terms', 'Text', 'd0000000-0000-4000-8000-000000000004');
set local role app_runtime;
do $$
begin
  -- Owner of partner C in its own partner context.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000002');
  if exists (select 1 from public.partner_legal_document_translations) then
    raise exception 'translations: visible to another partner';
  end if;
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000001', 'es', 'Términos', 'Texto', 'd0000000-0000-4000-8000-000000000006');
    raise exception 'translations: another partner wrote a translation';
  exception when insufficient_privilege then null;
  end;
  update public.partner_legal_document_translations
  set body = 'Other', updated_by = 'd0000000-0000-4000-8000-000000000006';
  if found then raise exception 'translations: another partner updated'; end if;
  delete from public.partner_legal_document_translations;
  if found then raise exception 'translations: another partner removed'; end if;

  -- Owner of partner C pretending to be in partner B's context.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001');
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000001', 'es', 'Términos', 'Texto', 'd0000000-0000-4000-8000-000000000006');
    raise exception 'translations: non-member wrote in another partner''s context';
  exception when insufficient_privilege then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 3: the platform publishes translations of the house partner; the
-- original in another language accepts a pt-BR translation
-- ----------------------------------------------------------------------------
begin;
insert into public.partner_legal_documents (id, partner_id, kind, version, title, body, locale, published_by)
values ('e0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000000',
        'privacy', 1, 'Privacy', 'Text', 'en', 'd0000000-0000-4000-8000-000000000003');
set local role app_runtime;
do $$
begin
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000000');
  insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
  values ('e0000000-0000-4000-8000-000000000002', 'pt-BR', 'Privacidade', 'Texto', 'd0000000-0000-4000-8000-000000000003');
  insert into public.partner_legal_document_translations (document_id, locale, title, body, origin, updated_by)
  values ('e0000000-0000-4000-8000-000000000002', 'es', 'Privacidad', 'Texto', 'machine', 'd0000000-0000-4000-8000-000000000003');
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000002', 'en', 'Privacy', 'Text', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'translations: platform translated into the language of the original';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000002', 'xx', 'X', 'X', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'translations: unknown language accepted';
  exception when foreign_key_violation then null;
  end;
  -- A regular user of the house partner reads but does not write.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000000');
  if (select count(*) from public.partner_legal_document_translations
      where document_id = 'e0000000-0000-4000-8000-000000000002') <> 2 then
    raise exception 'translations: house reader cannot read';
  end if;
  begin
    insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
    values ('e0000000-0000-4000-8000-000000000002', 'fr', 'X', 'X', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'translations: regular user wrote a translation';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
end
$$;
rollback;

-- ----------------------------------------------------------------------------
-- Test 4: removing the version removes its translations (as administrator)
-- ----------------------------------------------------------------------------
begin;
select pg_temp.translation_fixture();
insert into public.partner_legal_document_translations (document_id, locale, title, body, updated_by)
values ('e0000000-0000-4000-8000-000000000001', 'en', 'Terms', 'Text', 'd0000000-0000-4000-8000-000000000004');
delete from public.partner_legal_documents where id = 'e0000000-0000-4000-8000-000000000001';
do $$
begin
  if exists (select 1 from public.partner_legal_document_translations) then
    raise exception 'translations: survived their version';
  end if;
end
$$;
rollback;
