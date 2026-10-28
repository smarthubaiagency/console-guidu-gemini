# Módulo Cliente Hub: dados e migrations propostas

- **Status:** proposta para aprovar no PR, 24/10/2026. **Nada daqui é aplicado** antes da aprovação do Marcelo; a migration nasce em `supabase/migrations/` na etapa CH-A, a partir deste rascunho, e o CI a reaplica do zero.
- **Especificação:** [especificacao.md](especificacao.md). Muda a seção 5 da [proposta](proposta.md): o catálogo de blocos sai do banco e vai para o código (CH1), e entram as tabelas de imagens e de tokens de prévia.

## 1. Tabelas

| Tabela               | Para quê                                                                                               | Quem lê                                                                  | Quem grava                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `hub_configs`        | Um rascunho por workspace: configuração (`HubConfigV1` em `jsonb`), `revision`, versão publicada atual | `owner` e `admin`; parceiro no modo gerenciado                           | Os mesmos                                                               |
| `hub_versions`       | Versões publicadas: retrato completo, número, quem publicou, quando, "o que mudou". **Só inserção**    | Os mesmos; a leitura pública passa pela função `private.hub_published()` | Os mesmos (inserção); ninguém altera nem apaga, só a purga do workspace |
| `hub_assets`         | Imagens enviadas (logo e capa): caminho no Storage, tamanhos, hash, quem enviou, quando foi solta      | Os mesmos                                                                | Os mesmos; a limpeza semanal pelo worker                                |
| `hub_preview_tokens` | Tokens de prévia e códigos para o celular, só o hash, com validade e alvo (rascunho ou versão)         | Ninguém pelo `app_runtime`; a troca é por função                         | Funções `security definer`                                              |

Cascata: chaves `cliente_hub.enabled` e `cliente_hub.blocks` em `public.settings` (ADR 0018), sem tabela nova; só o catálogo em `src/core/settings/catalog.ts`.

Storage: bucket `hub-public` (leitura pública, sem listagem), escrita só pelo servidor por URL assinada; caminho `{workspace_id}/{sha256}.webp`.

## 2. Rascunho da migration (`2026122509xxxx_ch1_cliente_hub.sql`)

O nome definitivo segue a sequência do repositório no dia em que a etapa entrar. Padrões iguais aos das migrations atuais: dono `app_migrations`, `force row level security`, contexto por `private.context_uuid`, papel por `private.current_workspace_role()` e modo gerenciado por `private.partner_manages_organization()` (ADR 0020).

```sql
-- ============================================================================
-- Migration: 2026122509xxxx_ch1_cliente_hub.sql
-- Module: CH1 — Cliente Hub (store area): draft, published versions,
--         images and preview tokens (docs/modules/cliente-hub/dados.md)
--
-- Maintenance Rationale:
-- 1. One draft per workspace (`hub_configs`). Saving bumps `revision`; the
--    app sends the revision it read and gets a conflict when it is stale.
-- 2. `hub_versions` is append only: a published version never changes.
--    Restoring copies a version into the draft; it does not publish.
-- 3. Owner and admin of the workspace manage; the managing partner too
--    (ADR 0020). Attendants do not read anything here.
-- 4. The public API reads only the published version, through
--    `private.hub_published(slug)` (security definer), never the draft.
-- 5. Preview tokens keep only the hash; they are created and exchanged by
--    security definer functions and expire in 10 minutes.
-- 6. Deleting the workspace deletes everything (cascade and WS1 purge).
-- ============================================================================

create table public.hub_configs (
  workspace_id         uuid primary key,
  organization_id      uuid not null,
  config               jsonb not null,
  schema_version       smallint not null default 1,
  revision             integer not null default 1,
  published_version_id uuid,
  updated_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint hub_configs_config_size check (pg_column_size(config) <= 262144),
  constraint fk_hub_configs_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create table public.hub_versions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  organization_id  uuid not null,
  number           integer not null,
  config           jsonb not null,
  schema_version   smallint not null,
  note             text check (note is null or length(note) <= 120),
  restored_from    uuid references public.hub_versions(id) on delete set null,
  published_by     uuid references public.profiles(id) on delete set null,
  published_at     timestamptz not null default now(),
  unique (workspace_id, number),
  constraint fk_hub_versions_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

alter table public.hub_configs
  add constraint fk_hub_configs_published
  foreign key (published_version_id) references public.hub_versions(id) on delete set null;

create table public.hub_assets (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  organization_id  uuid not null,
  kind             text not null check (kind in ('logo', 'cover')),
  storage_path     text not null unique,
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width            integer not null check (width > 0),
  height           integer not null check (height > 0),
  bytes            integer not null check (bytes > 0 and bytes <= 4194304),
  status           text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  released_at      timestamptz,   -- no draft nor version uses it any more
  constraint fk_hub_assets_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create table public.hub_preview_tokens (
  token_hash       text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  workspace_id     uuid not null,
  organization_id  uuid not null,
  kind             text not null check (kind in ('editor', 'device_code')),
  target_version   uuid references public.hub_versions(id) on delete cascade, -- null = draft
  created_by       uuid references public.profiles(id) on delete set null,
  expires_at       timestamptz not null,
  used_at          timestamptz,   -- device codes are single use
  created_at       timestamptz not null default now(),
  constraint hub_preview_tokens_ttl check (expires_at <= created_at + interval '10 minutes'),
  constraint fk_hub_preview_tokens_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index hub_versions_workspace_number_idx on public.hub_versions (workspace_id, number desc);
create index hub_assets_workspace_idx on public.hub_assets (workspace_id);
create index hub_assets_released_idx on public.hub_assets (released_at) where released_at is not null;
create index hub_preview_tokens_expires_idx on public.hub_preview_tokens (expires_at);

create trigger hub_configs_touch before update on public.hub_configs
  for each row execute function private.touch_updated_at();

-- Owners, RLS, grants (same block for each table).
alter table public.hub_configs owner to app_migrations;
alter table public.hub_versions owner to app_migrations;
alter table public.hub_assets owner to app_migrations;
alter table public.hub_preview_tokens owner to app_migrations;
revoke all on public.hub_configs, public.hub_versions, public.hub_assets,
  public.hub_preview_tokens from public, anon, authenticated;
alter table public.hub_configs enable row level security;
alter table public.hub_configs force row level security;
alter table public.hub_versions enable row level security;
alter table public.hub_versions force row level security;
alter table public.hub_assets enable row level security;
alter table public.hub_assets force row level security;
alter table public.hub_preview_tokens enable row level security;
alter table public.hub_preview_tokens force row level security;

-- Who manages the store area of the context workspace.
create function private.hub_can_manage() returns boolean
  language sql stable security definer set search_path = '' as $$
  select private.current_workspace_role() in ('owner', 'admin')
      or private.partner_manages_organization(private.context_uuid('app.organization_id'))
$$;
alter function private.hub_can_manage() owner to app_rls_helper;

create policy hub_configs_manage on public.hub_configs
  for all to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.hub_can_manage())
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.hub_can_manage())
  );
grant select, insert, update on public.hub_configs to app_runtime;

-- Versions: read and insert only. No update or delete policy for app_runtime.
create policy hub_versions_select on public.hub_versions
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.hub_can_manage())
  );
create policy hub_versions_insert on public.hub_versions
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.hub_can_manage())
    and published_by = private.context_uuid('app.user_id')
  );
grant select, insert on public.hub_versions to app_runtime;

create policy hub_assets_manage on public.hub_assets
  for all to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.hub_can_manage())
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.hub_can_manage())
  );
grant select, insert, update on public.hub_assets to app_runtime;

-- Worker: purge of a deleted workspace (WS1), orphan images, expired tokens.
create policy hub_configs_worker on public.hub_configs for all to app_worker using (true) with check (true);
create policy hub_versions_worker on public.hub_versions for all to app_worker using (true) with check (true);
create policy hub_assets_worker on public.hub_assets for all to app_worker using (true) with check (true);
create policy hub_preview_tokens_worker on public.hub_preview_tokens for all to app_worker using (true) with check (true);
grant select, insert, update, delete on public.hub_configs, public.hub_versions,
  public.hub_assets, public.hub_preview_tokens to app_worker;

-- Public read of the published version by store slug (API H1). Returns
-- only the published config, never the draft, and only for a workspace
-- whose module is enabled by the cascade (checked by the caller in code).
create function private.hub_published(p_slug text)
  returns table (workspace_id uuid, version_id uuid, number integer,
                 config jsonb, schema_version smallint, published_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select v.workspace_id, v.id, v.number, v.config, v.schema_version, v.published_at
  from public.hub_configs c
  join public.hub_versions v on v.id = c.published_version_id
  join public.workspaces w on w.id = c.workspace_id
  where w.slug = p_slug  -- see review point 6: the store slug of the API
$$;
alter function private.hub_published(text) owner to app_rls_helper;
grant execute on function private.hub_published(text) to app_runtime;

-- Preview tokens: created for the context workspace by who manages it;
-- exchanged (device code → editor token) and resolved without context.
-- Bodies in the stage; each one hashes with sha256 and checks expires_at.
-- private.hub_preview_create(kind, target_version) returns text  -- the raw token, once
-- private.hub_preview_resolve(token) returns (workspace_id, target_version)
-- private.hub_preview_exchange(device_code) returns text
```

## 3. Pontos para a revisão do PR

1. `hub_versions` sem política de `update`/`delete` para o `app_runtime`: versão publicada não muda. A conferência entra no teste de banco.
2. `number` da versão é calculado na mesma transação da publicação (`max(number) + 1` com bloqueio da linha de `hub_configs`), para duas publicações simultâneas não gerarem o mesmo número.
3. `private.hub_published` devolve só a versão publicada; o rascunho nunca sai pela API pública. A conferência de `cliente_hub.enabled` fica no código, porque a cascata já tem o resolvedor (ADR 0018).
4. A exportação e a exclusão do workspace (F3e e WS1) passam a incluir as quatro tabelas e as imagens do bucket.
5. Nenhum dado de turista mora aqui. Favoritos, vistos e pedidos continuam nas tabelas da API do guidu.chat (Supabase do guidu.chat e Vendure, N4); o H2 só os filtra pela loja.
6. **Slug da loja.** O rascunho usa `workspaces.slug`. Se a etapa MA1 criar um slug próprio de loja para a API (por exemplo, no registro de mini-apps), a função passa a usar esse. Na V1, **uma área por workspace**; workspace com várias unidades tem uma área só.
