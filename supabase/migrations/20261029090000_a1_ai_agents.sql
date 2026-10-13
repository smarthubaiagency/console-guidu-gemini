-- ============================================================================
-- Migration: 20261029090000_a1_ai_agents.sql
-- Module: A1 — Data of the AI agents module (especificação v1.0 §6, §11 e §12;
--         campos.md)
--
-- Maintenance Rationale:
-- 1. `public.ai_agent_templates`: agent templates (the legacy presets). The
--    house owns templates with `partner_id` null; a partner owns its own.
--    `kind = 'admin'` is the single template every partner Assistant is born
--    from, kept by the house. `defaults` is the configuration document, one
--    JSON object per editor tab, validated by the Zod schema of
--    `config_version` (src/core/ai/config).
-- 2. `public.ai_agents`: the agents. `assistant` belongs to a partner (one
--    per partner, partial unique index); `guid` belongs to a workspace. Only
--    what is filtered or constrained is a column; the rest is `config`.
-- 3. `public.ai_agent_referrals`: professionals or companies a GUIDS
--    forwards out-of-scope leads to (the legacy `ai_agent_partners`).
-- 4. `public.ai_lead_activities`: lead scoring log per CRM contact, insert
--    only. The engine (A2) writes it; this stage creates the table, its
--    reading and the workspace purge.
-- 5. Partner access (revisão da ADR 0012, D-AG-17): members of a partner
--    read the configuration of the GUIDS of the partner's customers
--    (`organizations.partner_id`) and owner/admin edit it, signing the row
--    with `updated_by_partner_id`. Referrals and lead activities stay with
--    the workspace; conversations arrive in A2 with the same rule.
-- 6. Every new partner gets its Assistant from the admin template (trigger
--    on `partners`, security invoker); existing partners get theirs here.
-- 7. Seeds: the admin template and the two legacy presets (Anna SDR and
--    Assistente de Onboarding) as published house templates. Their texts
--    are starting points, edited in /platform from A3 on.
-- 8. `crm_contacts` gains a unique (id, workspace_id), so the lead log can
--    reference a contact of its own workspace only.
-- The prototype tables (agent_configs, agent_sessions, agent_messages) stay
-- until A2, which removes them with the prototype code.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- Seeds are written before RLS is enabled: scripts/migrate.ts runs as
-- app_migrations, which is NOBYPASSRLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Templates
-- ----------------------------------------------------------------------------
create table public.ai_agent_templates (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid references public.partners(id) on delete cascade,
  kind            text not null check (kind in ('guid', 'admin')),
  name            text not null check (length(btrim(name)) between 1 and 80),
  description     text check (description is null or length(description) <= 500),
  segment         text check (segment is null or length(segment) <= 80),
  prompt_template text not null default '' check (length(prompt_template) <= 50000),
  defaults        jsonb not null default '{}'::jsonb check (jsonb_typeof(defaults) = 'object'),
  config_version  integer not null default 1 check (config_version >= 1),
  version         integer not null default 1 check (version >= 1),
  published       boolean not null default false,
  approved_by     uuid references public.profiles(id) on delete set null,
  approved_at     timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The admin template is the house's.
  check (kind = 'guid' or partner_id is null)
);

create unique index ai_agent_templates_single_admin
  on public.ai_agent_templates (kind) where kind = 'admin';
create index ai_agent_templates_partner_idx
  on public.ai_agent_templates (partner_id, kind);

-- ----------------------------------------------------------------------------
-- 2. Agents
-- ----------------------------------------------------------------------------
create table public.ai_agents (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('assistant', 'guid')),
  partner_id            uuid references public.partners(id) on delete cascade,
  organization_id       uuid,
  workspace_id          uuid,
  template_id           uuid references public.ai_agent_templates(id) on delete set null,
  template_version      integer check (template_version is null or template_version >= 1),
  customized            boolean not null default false,
  config                jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  config_version        integer not null default 1 check (config_version >= 1),
  status                text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  -- Backup of the customer key (especificação §9.2), driven by the engine.
  key_state             text not null default 'ok' check (key_state in ('ok', 'backup', 'failed')),
  backup_started_at     timestamptz,
  last_tested_at        timestamptz,
  created_by            uuid references public.profiles(id) on delete set null,
  updated_by            uuid references public.profiles(id) on delete set null,
  -- Set when a partner changed the configuration ("Alterado por …", §6).
  updated_by_partner_id uuid references public.partners(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ai_agents_owner_check check (
    (kind = 'assistant' and partner_id is not null and workspace_id is null and organization_id is null)
    or (kind = 'guid' and partner_id is null and workspace_id is not null and organization_id is not null)
  ),
  constraint ai_agents_backup_check check (key_state <> 'backup' or backup_started_at is not null),
  constraint fk_ai_agents_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint ai_agents_id_workspace_key unique (id, workspace_id)
);

create unique index ai_agents_one_assistant_per_partner
  on public.ai_agents (partner_id) where kind = 'assistant';
create index ai_agents_workspace_idx
  on public.ai_agents (workspace_id, created_at) where kind = 'guid';
create index ai_agents_organization_idx
  on public.ai_agents (organization_id) where kind = 'guid';
create index ai_agents_template_idx on public.ai_agents (template_id);

-- ----------------------------------------------------------------------------
-- 3. Referrals
-- ----------------------------------------------------------------------------
create table public.ai_agent_referrals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id    uuid not null,
  name            text not null check (length(btrim(name)) between 1 and 160),
  referral_tag    text not null check (referral_tag ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' and length(referral_tag) <= 60),
  specialties     text[] not null default '{}' check (cardinality(specialties) <= 50),
  phone           text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  city            text check (city is null or length(city) <= 120),
  remote          boolean not null default false,
  created_by      uuid not null references public.profiles(id) on delete cascade,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fk_ai_agent_referrals_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint ai_agent_referrals_tag_key unique (workspace_id, referral_tag),
  constraint ai_agent_referrals_id_workspace_key unique (id, workspace_id)
);

-- ----------------------------------------------------------------------------
-- 4. Lead activities (scoring log, insert only)
-- ----------------------------------------------------------------------------
alter table public.crm_contacts
  add constraint crm_contacts_id_workspace_key unique (id, workspace_id);

create table public.ai_lead_activities (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  workspace_id          uuid not null,
  contact_id            uuid not null,
  agent_id              uuid not null,
  referral_id           uuid,
  points                integer not null check (points between -100000 and 100000),
  temperature           text not null check (temperature in ('hot', 'warm', 'cold', 'suspect')),
  -- [{ rule_id, label, points }]
  score_breakdown       jsonb not null default '[]'::jsonb check (jsonb_typeof(score_breakdown) = 'array'),
  scoring_rules_version integer check (scoring_rules_version is null or scoring_rules_version >= 1),
  created_at            timestamptz not null default now(),
  constraint fk_ai_lead_activities_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint fk_ai_lead_activities_contact
    foreign key (contact_id, workspace_id)
    references public.crm_contacts(id, workspace_id) on delete cascade,
  constraint fk_ai_lead_activities_agent
    foreign key (agent_id, workspace_id)
    references public.ai_agents(id, workspace_id) on delete cascade,
  constraint fk_ai_lead_activities_referral
    foreign key (referral_id, workspace_id)
    references public.ai_agent_referrals(id, workspace_id) on delete set null (referral_id)
);

create index ai_lead_activities_contact_idx
  on public.ai_lead_activities (workspace_id, contact_id, created_at desc);
create index ai_lead_activities_agent_idx
  on public.ai_lead_activities (agent_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. Seeds: house templates and one Assistant per existing partner
-- ----------------------------------------------------------------------------
insert into public.ai_agent_templates
  (id, partner_id, kind, name, description, segment, prompt_template, defaults, published)
values
(
  'a1a00000-0000-4000-8000-000000000001', null, 'admin', 'Assistente GUIDU',
  'Modelo do Assistente de cada parceiro: tira dúvidas de quem está logado no painel.',
  'Plataforma',
  $prompt$Você é {{agent_name}}, o assistente do painel. Responda em {{language}}, com tom {{agent_tone}}.

SOBRE A EMPRESA
{{business_summary}}

O QUE A PLATAFORMA OFERECE
{{products_services}}

COMO RESPONDER
- Responda só sobre o uso do painel e sobre os dados que a pessoa pode ver.
- Seja breve e diga onde fica cada opção no menu.
- Nunca altere nada sem a confirmação da pessoa.
- Fora do escopo: {{out_of_scope_action}}
- Transferência para humano: {{handoff_mode}}$prompt$,
  $json${
    "overview": {
      "agent_name": "Assistente GUIDU",
      "agent_tone": "friendly",
      "language": "pt-BR",
      "segment": "Plataforma",
      "business_summary": "",
      "products_services": "",
      "persona_context": "Assistente do painel, que conhece as áreas, os módulos e as configurações da plataforma.",
      "expected_output": "Respostas curtas, com o caminho no menu quando houver.",
      "system_prompt": "",
      "prompt_version": 1
    },
    "scope": {
      "remote_allowed": true,
      "travel_allowed": false,
      "coverage_areas": [],
      "coverage_cities": [],
      "timezone": "America/Sao_Paulo",
      "availability_slots": []
    },
    "rules": {
      "lead_scoring_rules": [],
      "scoring_rules_version": 1,
      "handoff_mode": "never",
      "after_hours_behavior": "auto_reply_only",
      "out_of_scope_action": "say_dont_know",
      "refuses_pricing": false,
      "refuses_competitor_comparison": true,
      "refuses_delivery_commitment": true,
      "partner_referral_notify": false
    },
    "integration": {
      "tools": ["think", "search_knowledge", "workspace_read", "propose_operation"],
      "lead_destination": "crm",
      "onboarding_completed": false
    },
    "model": {
      "audio_enabled": false,
      "rag_enabled": true
    }
  }$json$::jsonb,
  true
),
(
  'a1a00000-0000-4000-8000-000000000002', null, 'guid', 'Anna (SDR)',
  'Primeiro atendimento comercial: entende o contato, qualifica com pontuação e passa para o time.',
  'Vendas',
  $prompt$Você é {{agent_name}}, responsável pelo primeiro atendimento comercial. Responda em {{language}}, com tom {{agent_tone}}.

SOBRE O NEGÓCIO
Segmento: {{segment}}
Resumo: {{business_summary}}
Produtos e serviços: {{products_services}}
Contexto da persona: {{persona_context}}

ONDE ATENDE
Base: {{base_city}}/{{base_state}}, fuso {{timezone}}. Cidades: {{coverage_cities}}. Áreas: {{coverage_areas}}. Raio: {{coverage_radius_km}} km.
Atende remoto: {{remote_allowed}}. Aceita deslocamento: {{travel_allowed}}.
Horário de atendimento: {{availability_slots}}.

COMO CONDUZIR
- Nunca se apresente como robô e nunca diga que está qualificando ou coletando dados.
- Faça uma pergunta por vez.
- Entenda quem é o contato, o que ele precisa e em que momento de compra está.
- Colete aos poucos o nome, a empresa, o e-mail e a necessidade principal.
- Termine sempre com uma próxima ação clara: agendar uma conversa, enviar material ou conectar com o time.

REGRAS
- Não informa preços: {{refuses_pricing}}. Não compara com concorrentes: {{refuses_competitor_comparison}}. Não promete prazos: {{refuses_delivery_commitment}}.
- Transferência para humano: {{handoff_mode}}
- Fora do horário: {{after_hours_behavior}}
- Fora do escopo: {{out_of_scope_action}}
- Avisa a indicação ao encaminhar: {{partner_referral_notify}}. Mensagem de encaminhamento: {{partner_message_template}}
- Destino dos leads: {{lead_destination}}$prompt$,
  $json${
    "overview": {
      "agent_name": "Anna",
      "agent_tone": "friendly",
      "language": "pt-BR",
      "segment": "Vendas",
      "business_summary": "",
      "products_services": "",
      "persona_context": "Consultiva, confiante, leve e direta. Descobre a necessidade antes de falar de solução.",
      "expected_output": "Contato qualificado com nome, empresa, e-mail e necessidade, e uma próxima ação combinada.",
      "system_prompt": "",
      "prompt_version": 1
    },
    "scope": {
      "remote_allowed": true,
      "travel_allowed": false,
      "coverage_areas": [],
      "coverage_cities": [],
      "timezone": "America/Sao_Paulo",
      "availability_slots": [
        { "weekday": "mon", "start": "09:00", "end": "18:00" },
        { "weekday": "tue", "start": "09:00", "end": "18:00" },
        { "weekday": "wed", "start": "09:00", "end": "18:00" },
        { "weekday": "thu", "start": "09:00", "end": "18:00" },
        { "weekday": "fri", "start": "09:00", "end": "18:00" }
      ]
    },
    "rules": {
      "hot_score_threshold": 60,
      "warm_score_threshold": 30,
      "notify_on_score": 60,
      "lead_scoring_rules": [
        { "rule_id": "fala_por_empresa", "key_group": "perfil", "label": "Fala por uma empresa", "signal": "O contato fala em nome de uma empresa ou equipe", "points": 20 },
        { "rule_id": "email_corporativo", "key_group": "perfil", "label": "E-mail corporativo", "signal": "Informa um e-mail com domínio da empresa", "points": 15, "capture_field": "email" },
        { "rule_id": "pede_proposta", "key_group": "intencao", "label": "Pede proposta", "signal": "Pede proposta, preço ou uma reunião", "points": 30, "notify_immediately": true },
        { "rule_id": "prazo_definido", "key_group": "intencao", "label": "Prazo definido", "signal": "Tem prazo para decidir ou começar", "points": 15 },
        { "rule_id": "so_pesquisando", "key_group": "intencao", "label": "Só pesquisando", "signal": "Diz que está só pesquisando, sem necessidade agora", "points": -10 }
      ],
      "scoring_rules_version": 1,
      "notify_channel": "whatsapp",
      "handoff_mode": "high_intent",
      "after_hours_behavior": "offer_callback",
      "out_of_scope_action": "escalate_team",
      "refuses_pricing": true,
      "refuses_competitor_comparison": true,
      "refuses_delivery_commitment": true,
      "partner_referral_notify": false
    },
    "integration": {
      "tools": ["think", "create_contact", "add_note", "update_contact_property", "set_conversation_variable", "score_lead", "handoff"],
      "lead_destination": "crm",
      "onboarding_completed": false
    },
    "model": {
      "audio_enabled": false,
      "rag_enabled": false
    }
  }$json$::jsonb,
  true
),
(
  'a1a00000-0000-4000-8000-000000000003', null, 'guid', 'Assistente de Onboarding',
  'Acompanha clientes novos nos primeiros passos e tira dúvidas de uso.',
  'Sucesso do cliente',
  $prompt$Você é {{agent_name}}, responsável por acompanhar clientes novos nos primeiros passos. Responda em {{language}}, com tom {{agent_tone}}.

SOBRE O NEGÓCIO
Segmento: {{segment}}
Resumo: {{business_summary}}
Produtos e serviços: {{products_services}}
Contexto da persona: {{persona_context}}

COMO CONDUZIR
- Descubra em que etapa o cliente está e indique o próximo passo, um de cada vez.
- Confirme se o passo deu certo antes de seguir.
- Horário de atendimento: {{availability_slots}} (fuso {{timezone}}).

REGRAS
- Não promete prazos: {{refuses_delivery_commitment}}.
- Transferência para humano: {{handoff_mode}}
- Fora do horário: {{after_hours_behavior}}
- Fora do escopo: {{out_of_scope_action}}$prompt$,
  $json${
    "overview": {
      "agent_name": "Assistente de Onboarding",
      "agent_tone": "professional",
      "language": "pt-BR",
      "segment": "Sucesso do cliente",
      "business_summary": "",
      "products_services": "",
      "persona_context": "Paciente e objetivo, guia o cliente passo a passo.",
      "expected_output": "Cliente com a próxima etapa do onboarding concluída ou encaminhado ao time.",
      "system_prompt": "",
      "prompt_version": 1
    },
    "scope": {
      "remote_allowed": true,
      "travel_allowed": false,
      "coverage_areas": [],
      "coverage_cities": [],
      "timezone": "America/Sao_Paulo",
      "availability_slots": [
        { "weekday": "mon", "start": "09:00", "end": "18:00" },
        { "weekday": "tue", "start": "09:00", "end": "18:00" },
        { "weekday": "wed", "start": "09:00", "end": "18:00" },
        { "weekday": "thu", "start": "09:00", "end": "18:00" },
        { "weekday": "fri", "start": "09:00", "end": "18:00" }
      ]
    },
    "rules": {
      "lead_scoring_rules": [],
      "scoring_rules_version": 1,
      "handoff_mode": "always_ask",
      "after_hours_behavior": "inform_hours",
      "out_of_scope_action": "say_dont_know",
      "refuses_pricing": true,
      "refuses_competitor_comparison": true,
      "refuses_delivery_commitment": true,
      "partner_referral_notify": false
    },
    "integration": {
      "tools": ["think", "add_note", "set_conversation_variable", "handoff"],
      "lead_destination": "crm",
      "onboarding_completed": false
    },
    "model": {
      "audio_enabled": false,
      "rag_enabled": false
    }
  }$json$::jsonb,
  true
);

-- The Assistant of a partner: the admin template, named after the partner.
create function private.ai_assistant_config(p_defaults jsonb, p_partner_name text)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_set(p_defaults, '{overview,agent_name}', to_jsonb('Assistente ' || p_partner_name), true);
$$;

alter function private.ai_assistant_config(jsonb, text) owner to app_migrations;
revoke execute on function private.ai_assistant_config(jsonb, text) from public, anon, authenticated;
grant execute on function private.ai_assistant_config(jsonb, text) to app_runtime;

-- Existing partners. partners is FORCE RLS without a policy for
-- app_migrations, so it is read with RLS off for this statement only.
alter table public.partners no force row level security;
insert into public.ai_agents (kind, partner_id, template_id, template_version, config, config_version)
select 'assistant', partner.id, template.id, template.version,
       private.ai_assistant_config(template.defaults, partner.name), template.config_version
from public.partners partner
cross join public.ai_agent_templates template
where template.kind = 'admin';
alter table public.partners force row level security;

-- ----------------------------------------------------------------------------
-- 6. Ownership, RLS, timestamps and immutable columns
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['ai_agent_templates', 'ai_agents', 'ai_agent_referrals', 'ai_lead_activities'] loop
    execute format('alter table public.%I owner to app_migrations', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
  foreach t in array array['ai_agent_templates', 'ai_agents', 'ai_agent_referrals'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;

create function private.ai_agents_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Nested ifs: each table only has its own columns.
  if tg_table_name = 'ai_agents' then
    if new.kind is distinct from old.kind
       or new.partner_id is distinct from old.partner_id
       or new.workspace_id is distinct from old.workspace_id
       or new.organization_id is distinct from old.organization_id then
      raise exception 'ai agents: kind and owner are immutable'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'ai_agent_templates' then
    if new.kind is distinct from old.kind
       or new.partner_id is distinct from old.partner_id then
      raise exception 'ai agent templates: kind and owner are immutable'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'ai_agent_referrals' then
    if new.workspace_id is distinct from old.workspace_id
       or new.organization_id is distinct from old.organization_id then
      raise exception 'ai agent referrals: workspace is immutable'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'ai agents: id, author and creation time are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter function private.ai_agents_guard_update() owner to app_migrations;
revoke execute on function private.ai_agents_guard_update() from public, anon, authenticated;

create trigger ai_agent_templates_guard_update
  before update on public.ai_agent_templates
  for each row execute function private.ai_agents_guard_update();
create trigger ai_agents_guard_update
  before update on public.ai_agents
  for each row execute function private.ai_agents_guard_update();
create trigger ai_agent_referrals_guard_update
  before update on public.ai_agent_referrals
  for each row execute function private.ai_agents_guard_update();

-- Roles of the workspace permissions (src/core/permissions/matrix.ts):
-- ai_agents.use = owner, admin, editor; ai_agents.manage = owner, admin.
-- Partner permissions: partner.ai_agents.read = owner, admin, support;
-- partner.ai_agents.manage = owner, admin. platform.ai.manage = owner,
-- operations.

-- ----------------------------------------------------------------------------
-- 7. Policies: templates
-- ----------------------------------------------------------------------------
create policy ai_agent_templates_select on public.ai_agent_templates
  for select to app_runtime
  using (
    -- Platform: every template.
    private.current_platform_admin_role() is not null
    -- Partner console: its own templates and the published house ones.
    or (
      private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
      and (
        partner_id = private.current_partner_id()
        or (partner_id is null and kind = 'guid' and published)
      )
    )
    -- Workspace: published GUIDS templates of the house and of its partner.
    or (
      kind = 'guid'
      and published
      and private.current_workspace_role() in ('owner', 'admin', 'editor')
      and (
        partner_id is null
        or (
          partner_id = private.current_partner_id()
          and private.is_partner_organization(private.context_uuid('app.organization_id'))
        )
      )
    )
  );

create policy ai_agent_templates_insert on public.ai_agent_templates
  for insert to app_runtime
  with check (
    created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and kind = 'guid'
    and (
      (partner_id is null and private.current_platform_admin_role() in ('owner', 'operations'))
      or (
        partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin')
      )
    )
  );

create policy ai_agent_templates_update on public.ai_agent_templates
  for update to app_runtime
  using (
    (partner_id is null and private.current_platform_admin_role() in ('owner', 'operations'))
    or (
      partner_id = private.current_partner_id()
      and private.current_partner_role() in ('partner_owner', 'partner_admin')
    )
  )
  with check (
    updated_by = private.context_uuid('app.user_id')
    and (
      (partner_id is null and private.current_platform_admin_role() in ('owner', 'operations'))
      or (
        partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin')
      )
    )
  );

-- The admin template is never deleted.
create policy ai_agent_templates_delete on public.ai_agent_templates
  for delete to app_runtime
  using (
    kind = 'guid'
    and (
      (partner_id is null and private.current_platform_admin_role() in ('owner', 'operations'))
      or (
        partner_id = private.current_partner_id()
        and private.current_partner_role() in ('partner_owner', 'partner_admin')
      )
    )
  );

grant select, insert, update, delete on public.ai_agent_templates to app_runtime;

-- ----------------------------------------------------------------------------
-- 8. Policies: agents
-- ----------------------------------------------------------------------------
create policy ai_agents_select on public.ai_agents
  for select to app_runtime
  using (
    -- GUIDS: members of the workspace with ai_agents.use.
    (
      kind = 'guid'
      and workspace_id = private.context_uuid('app.workspace_id')
      and organization_id = private.context_uuid('app.organization_id')
      and private.current_workspace_role() in ('owner', 'admin', 'editor')
    )
    -- GUIDS of the partner's customers: configuration only (D-AG-17).
    or (
      kind = 'guid'
      and private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
      and private.is_partner_organization(organization_id)
    )
    -- The partner's Assistant.
    or (
      kind = 'assistant'
      and partner_id = private.current_partner_id()
      and private.current_partner_role() in ('partner_owner', 'partner_admin', 'partner_support')
    )
  );

create policy ai_agents_workspace_insert on public.ai_agents
  for insert to app_runtime
  with check (
    kind = 'guid'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and updated_by_partner_id is null
    and private.current_workspace_role() in ('owner', 'admin')
  );

-- A new partner's Assistant, written by the trigger on partners in the
-- transaction of the platform user who creates the partner.
create policy ai_agents_assistant_insert on public.ai_agents
  for insert to app_runtime
  with check (
    kind = 'assistant'
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and updated_by_partner_id is null
    and private.current_platform_admin_role() in ('owner', 'operations')
  );

create policy ai_agents_workspace_update on public.ai_agents
  for update to app_runtime
  using (
    kind = 'guid'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  )
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and updated_by = private.context_uuid('app.user_id')
    and updated_by_partner_id is null
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy ai_agents_partner_update on public.ai_agents
  for update to app_runtime
  using (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and (
      (kind = 'guid' and private.is_partner_organization(organization_id))
      or (kind = 'assistant' and partner_id = private.current_partner_id())
    )
  )
  with check (
    private.current_partner_role() in ('partner_owner', 'partner_admin')
    and updated_by = private.context_uuid('app.user_id')
    and updated_by_partner_id = private.current_partner_id()
    and (
      (kind = 'guid' and private.is_partner_organization(organization_id))
      or (kind = 'assistant' and partner_id = private.current_partner_id())
    )
  );

-- Only the workspace deletes its GUIDS; an Assistant is never deleted.
create policy ai_agents_workspace_delete on public.ai_agents
  for delete to app_runtime
  using (
    kind = 'guid'
    and workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert, update, delete on public.ai_agents to app_runtime;

-- ----------------------------------------------------------------------------
-- 9. Policies: referrals and lead activities (workspace only)
-- ----------------------------------------------------------------------------
create policy ai_agent_referrals_select on public.ai_agent_referrals
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

create policy ai_agent_referrals_insert on public.ai_agent_referrals
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and created_by = private.context_uuid('app.user_id')
    and updated_by is null
    and private.current_workspace_role() in ('owner', 'admin')
  );

create policy ai_agent_referrals_update on public.ai_agent_referrals
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

create policy ai_agent_referrals_delete on public.ai_agent_referrals
  for delete to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin')
  );

grant select, insert, update, delete on public.ai_agent_referrals to app_runtime;

-- Read by the workspace; written by the engine from A2 on.
create policy ai_lead_activities_select on public.ai_lead_activities
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.current_workspace_role() in ('owner', 'admin', 'editor')
  );

grant select on public.ai_lead_activities to app_runtime;

-- Purge of a deleted workspace (F3e). Lead activities first: they reference
-- the agents, referrals and contacts.
do $$
declare
  t text;
begin
  foreach t in array array['ai_lead_activities', 'ai_agent_referrals', 'ai_agents'] loop
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

-- ----------------------------------------------------------------------------
-- 10. Every new partner gets its Assistant
-- ----------------------------------------------------------------------------
-- Security invoker: the insert runs as whoever creates the partner (the
-- platform owner/operations, by ai_agents_assistant_insert). Missing admin
-- template is an error, never a partner without an Assistant.
create function private.create_partner_assistant()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.ai_agent_templates%rowtype;
begin
  select * into v_template from public.ai_agent_templates where kind = 'admin';
  if not found then
    raise exception 'ai agents: admin template not found'
      using errcode = 'no_data_found';
  end if;
  insert into public.ai_agents
    (kind, partner_id, template_id, template_version, config, config_version, created_by)
  values
    ('assistant', new.id, v_template.id, v_template.version,
     private.ai_assistant_config(v_template.defaults, new.name), v_template.config_version,
     private.context_uuid('app.user_id'));
  return new;
end;
$$;

alter function private.create_partner_assistant() owner to app_migrations;
revoke execute on function private.create_partner_assistant() from public, anon, authenticated;

create trigger partners_create_assistant
  after insert on public.partners
  for each row execute function private.create_partner_assistant();
