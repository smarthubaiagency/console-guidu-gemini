-- ============================================================================
-- Revisão de segurança F6a: invariantes do catálogo real do banco.
-- Roda depois de todas as migrations (job `db` do CI e scripts/local/rebuild-db.sh)
-- e lê pg_catalog, não os arquivos: o que vale é o estado aplicado.
-- Completa tests/core/invariants.sql, que cobre só o schema public e o app_runtime.
-- Cada bloco levanta exceção com a lista do que violou a regra.
-- ============================================================================

-- 1. Toda tabela (comum ou particionada) de public e private tem RLS e FORCE RLS.
do $$
declare
  v_list text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ')
  into v_list
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p')
    and (not c.relrowsecurity or not c.relforcerowsecurity);

  if v_list is not null then
    raise exception 'F6a: tabela(s) sem RLS forçada: %', v_list;
  end if;
end
$$;

-- 2. anon, authenticated e PUBLIC não têm privilégio em tabela, sequence ou
-- função de public e private, nem CREATE nesses schemas.
do $$
declare
  v_list text;
begin
  select string_agg(item, '; ')
  into v_list
  from (
    select format('%s em %I.%I para %s', privilege_type, table_schema, table_name, grantee) as item
    from information_schema.role_table_grants
    where table_schema in ('public', 'private')
      and grantee in ('anon', 'authenticated', 'PUBLIC')
    union all
    select format('%s em %I.%I para %s', s.priv, n.nspname, c.relname, r.rolname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(rolname)
    cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as s(priv)
    where n.nspname in ('public', 'private')
      and c.relkind = 'S'
      and has_sequence_privilege(r.rolname, c.oid, s.priv)
    union all
    select format('EXECUTE em %I.%I para %s', n.nspname, p.proname, r.rolname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) as r(rolname)
    where n.nspname in ('public', 'private')
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    union all
    select format('CREATE no schema %I para %s', n.nspname, r.rolname)
    from pg_namespace n
    cross join (values ('anon'), ('authenticated'), ('app_runtime'), ('app_worker')) as r(rolname)
    where n.nspname in ('public', 'private')
      and has_schema_privilege(r.rolname, n.oid, 'CREATE')
  ) leaks;

  if v_list is not null then
    raise exception 'F6a: privilégio indevido: %', v_list;
  end if;
end
$$;

-- 3. Funções SECURITY DEFINER de public e private:
--   a. todas com search_path fixo e vazio;
--   b. as que o código chama pertencem ao app_rls_helper (sem login, sem BYPASSRLS);
--   c. as demais são funções de gatilho, que ninguém executa diretamente;
--   d. EXECUTE só para os papéis da aplicação, nunca para PUBLIC.
do $$
declare
  v_list text;
begin
  select string_agg(item, '; ')
  into v_list
  from (
    select format('%I.%I sem search_path vazio', n.nspname, p.proname) as item
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private')
      and not coalesce('search_path=""' = any (p.proconfig), false)
    union all
    select format('%I.%I pertence a %s', n.nspname, p.proname, pg_get_userbyid(p.proowner))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private')
      and p.prorettype <> 'trigger'::regtype
      and pg_get_userbyid(p.proowner) <> 'app_rls_helper'
    union all
    select format('%I.%I executável por PUBLIC', n.nspname, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private')
      and (p.proacl is null or exists (
        select 1 from aclexplode(p.proacl) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      ))
    union all
    select format('%I.%I executável por %s', n.nspname, p.proname, pg_get_userbyid(a.grantee))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    where p.prosecdef
      and n.nspname in ('public', 'private')
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> 0
      and a.grantee <> p.proowner
      and pg_get_userbyid(a.grantee) not in ('app_runtime', 'app_worker')
  ) problems;

  if v_list is not null then
    raise exception 'F6a: função SECURITY DEFINER fora da regra: %', v_list;
  end if;
end
$$;

-- 4. Atributos dos papéis da aplicação. Só app_runtime e app_worker fazem login;
-- nenhum é superusuário, cria papel ou banco, ou ignora RLS.
do $$
declare
  v_list text;
begin
  select string_agg(format('%s (login=%s super=%s createrole=%s createdb=%s bypassrls=%s)',
           rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls), '; ')
  into v_list
  from pg_roles
  where rolname in ('app_runtime', 'app_worker', 'app_migrations', 'app_rls_helper')
    and (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls
         or rolcanlogin <> (rolname in ('app_runtime', 'app_worker')));

  if v_list is not null then
    raise exception 'F6a: papel com atributo indevido: %', v_list;
  end if;

  if (select count(*) from pg_roles
      where rolname in ('app_runtime', 'app_worker', 'app_migrations', 'app_rls_helper')) <> 4 then
    raise exception 'F6a: faltam papéis da aplicação';
  end if;
end
$$;

-- 5. Vínculos entre os papéis da aplicação. O app_worker só pode assumir o
-- app_runtime com SET ROLE (sem herdar, F3a); app_runtime e app_worker não
-- herdam nem assumem nenhum outro papel.
do $$
declare
  v_list text;
begin
  select string_agg(format('%s em %s (inherit=%s set=%s)', m.rolname, r.rolname,
           a.inherit_option, a.set_option), '; ')
  into v_list
  from pg_auth_members a
  join pg_roles r on r.oid = a.roleid
  join pg_roles m on m.oid = a.member
  where m.rolname in ('app_runtime', 'app_worker')
    and not (m.rolname = 'app_worker' and r.rolname = 'app_runtime'
             and not a.inherit_option and a.set_option);

  if v_list is not null then
    raise exception 'F6a: vínculo de papel indevido: %', v_list;
  end if;
end
$$;

-- 6. Em public e private, app_runtime e app_worker só leem e escrevem dados:
-- nada de TRUNCATE, REFERENCES ou TRIGGER, e não são donos de tabela, função
-- ou schema. O schema pgboss é do app_worker por desenho (F3a): a fila cria e
-- particiona as próprias tabelas.
do $$
declare
  v_list text;
begin
  select string_agg(item, '; ')
  into v_list
  from (
    select format('%s em %I.%I para %s', privilege_type, table_schema, table_name, grantee) as item
    from information_schema.role_table_grants
    where grantee in ('app_runtime', 'app_worker')
      and table_schema in ('public', 'private')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    union all
    select format('%s é dono de %I.%I', pg_get_userbyid(c.relowner), n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where pg_get_userbyid(c.relowner) in ('app_runtime', 'app_worker')
      and n.nspname in ('public', 'private')
    union all
    select format('%s é dono da função %I.%I', pg_get_userbyid(p.proowner), n.nspname, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where pg_get_userbyid(p.proowner) in ('app_runtime', 'app_worker')
      and n.nspname in ('public', 'private')
    union all
    select format('%s é dono do schema %I', pg_get_userbyid(n.nspowner), n.nspname)
    from pg_namespace n
    where pg_get_userbyid(n.nspowner) in ('app_runtime', 'app_worker')
      and n.nspname <> 'pgboss'
  ) problems;

  if v_list is not null then
    raise exception 'F6a: privilégio estrutural indevido: %', v_list;
  end if;
end
$$;

-- 7. Variáveis de contexto definidas por quem chama (app.api_key_hash,
-- app.platform_api_key_hash, app.notification_email): só as funções e
-- políticas previstas as leem. Uma nova leitura precisa entrar nesta lista
-- depois de revisada, porque o valor vem do chamador.
-- Revisão F6a: as políticas abaixo valem só para app_rls_helper, alcançado
-- apenas dentro das funções SECURITY DEFINER. As únicas funções desse papel
-- que leem profiles ou partner_members são current_partner_role (filtra pelo
-- próprio app.user_id), get_admin_metrics e list_admin_users (exigem admin da
-- plataforma antes) e notification_locale (só app_worker; define e restaura a
-- variável). As tabelas de chaves só são lidas por resolve_api_key e
-- resolve_platform_api_key. Nenhuma amplia o acesso com o valor do chamador.
do $$
declare
  v_list text;
begin
  select string_agg(item, '; ')
  into v_list
  from (
    select format('função %I.%I lê %s', n.nspname, p.proname, v.name) as item
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('app.api_key_hash'), ('app.platform_api_key_hash'),
                       ('app.notification_email')) as v(name)
    where n.nspname in ('public', 'private')
      and p.prosrc like '%' || v.name || '%'
      and format('%s:%s', p.proname, v.name) not in (
        'resolve_api_key:app.api_key_hash',
        'resolve_platform_api_key:app.platform_api_key_hash',
        'notification_locale:app.notification_email'
      )
    union all
    select format('política %I em %I.%I lê %s', pol.polname, n.nspname, c.relname, v.name)
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('app.api_key_hash'), ('app.platform_api_key_hash'),
                       ('app.notification_email')) as v(name)
    where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
          || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') like '%' || v.name || '%'
      and format('%s.%s:%s', c.relname, pol.polname, v.name) not in (
        'api_keys.api_keys_helper_select:app.api_key_hash',
        'platform_api_keys.platform_api_keys_helper_select:app.platform_api_key_hash',
        'partner_members.partner_members_notification_helper_select:app.notification_email',
        'profiles.profiles_admin_helper_select:app.notification_email'
      )
  ) readers;

  if v_list is not null then
    raise exception 'F6a: leitura não revisada de variável do chamador: %', v_list;
  end if;
end
$$;
