-- ============================================================================
-- SQL languages (I1): platform languages and translations, the language of a
-- person and the default language of a workspace
--   platform owner d…003; workspace A a…011 (org a…010): owner a…031,
--   viewer a…033; workspace B a…021 (org a…020)
-- ============================================================================

create or replace function pg_temp.ctx(p_user uuid, p_ws uuid, p_org uuid) returns void
language sql as $$
  select set_config('app.user_id', p_user::text, true),
         set_config('app.workspace_id', coalesce(p_ws::text, ''), true),
         set_config('app.organization_id', coalesce(p_org::text, ''), true);
$$;

begin;
set local role app_runtime;
do $$
begin
  -- The platform owner manages languages and translations.
  perform pg_temp.ctx('d0000000-0000-4000-8000-000000000003', null, null);
  if (select count(*) from public.platform_languages where status = 'active') <> 3 then
    raise exception 'languages: pt-BR, en and es are not born active';
  end if;
  insert into public.platform_languages (code, name, created_by)
  values ('fr', 'Français', 'd0000000-0000-4000-8000-000000000003');
  insert into public.platform_translations (locale, key, value, updated_by)
  values ('en', 'nav.overview', 'Home', 'd0000000-0000-4000-8000-000000000003');
  insert into public.platform_translations (locale, key, value, updated_by)
  values ('fr', 'nav.overview', 'Accueil', 'd0000000-0000-4000-8000-000000000003');
  begin
    update public.platform_languages set status = 'disabled',
      updated_by = 'd0000000-0000-4000-8000-000000000003' where code = 'pt-BR';
    raise exception 'languages: the source language was disabled';
  exception when check_violation then null;
  end;
  begin
    update public.platform_languages set is_default = true,
      updated_by = 'd0000000-0000-4000-8000-000000000003' where code = 'en';
    raise exception 'languages: two default languages';
  exception when unique_violation then null;
  end;
  begin
    insert into public.platform_translations (locale, key, value, updated_by)
    values ('en', 'nav overview!', 'x', 'd0000000-0000-4000-8000-000000000003');
    raise exception 'languages: invalid key accepted';
  exception when check_violation then null;
  end;

  -- Readers: only active languages and their edits.
  if exists (select 1 from private.ui_languages() where code = 'fr') then
    raise exception 'languages: a draft language is offered';
  end if;
  if (select value from private.ui_translations('en') where key = 'nav.overview') <> 'Home' then
    raise exception 'languages: edit of an active language not read';
  end if;
  if exists (select 1 from private.ui_translations('fr')) then
    raise exception 'languages: edits of a draft language read';
  end if;

  -- A workspace member cannot read or write the tables.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  if exists (select 1 from public.platform_translations) then
    raise exception 'languages: member reads translations';
  end if;
  begin
    insert into public.platform_translations (locale, key, value, updated_by)
    values ('es', 'nav.overview', 'x', 'a0000000-0000-4000-8000-000000000031');
    raise exception 'languages: member wrote a translation';
  exception when insufficient_privilege then null;
  end;

  -- The owner sets the workspace default; only that column changes.
  update public.workspaces set default_locale = 'es'
  where id = 'a0000000-0000-4000-8000-000000000011';
  if not found then raise exception 'languages: owner cannot set the workspace language'; end if;
  begin
    update public.workspaces set name = 'Outro'
    where id = 'a0000000-0000-4000-8000-000000000011';
    raise exception 'languages: owner changed the workspace name through this policy';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.workspaces set default_locale = 'xx'
    where id = 'a0000000-0000-4000-8000-000000000011';
    raise exception 'languages: unknown language accepted';
  exception when foreign_key_violation then null;
  end;
  update public.workspaces set default_locale = 'en'
  where id = 'a0000000-0000-4000-8000-000000000021';
  if found then raise exception 'languages: language of another workspace changed'; end if;
  if private.ui_workspace_locale('workspace-a') is distinct from 'es' then
    raise exception 'languages: workspace language not read by its member';
  end if;
  if private.ui_workspace_locale('workspace-b') is not null then
    raise exception 'languages: language of a workspace of others read';
  end if;

  -- A person sets their own language.
  update public.profiles set locale = 'en' where id = 'a0000000-0000-4000-8000-000000000031';
  if not found then raise exception 'languages: person cannot set their language'; end if;

  -- The viewer cannot change the workspace default.
  perform pg_temp.ctx('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000011',
                      'a0000000-0000-4000-8000-000000000010');
  update public.workspaces set default_locale = 'pt-BR'
  where id = 'a0000000-0000-4000-8000-000000000011';
  if found then raise exception 'languages: viewer changed the workspace language'; end if;
end
$$;
reset role;
rollback;
