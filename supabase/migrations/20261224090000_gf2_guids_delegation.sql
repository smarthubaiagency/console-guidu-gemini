-- ============================================================================
-- Migration: 20261224090000_gf2_guids_delegation.sql
-- Module: GF2 — the orchestrator hands the conversation to the attendant or
--         to the seller (docs/architecture/plano-tr3-gf2.md, section GF2)
--
-- Maintenance Rationale:
-- 1. `ai_messages.author_agent_id` and `via_delegation`: which GUIDS wrote
--    an answer and whether it came by a delegation (the seller wrote it
--    while the contact talks to the orchestrator's name). Rows written
--    before the GF2 keep both empty (the conversation's own agent, no
--    delegation). The author must be a GUIDS of the conversation's own
--    workspace: a trigger checks it, because `ai_messages` carries no
--    workspace column for a composite foreign key.
-- 2. `ai_conversations.delegated_agent_id` and `delegated_until`: while a
--    specialist holds the conversation, the next messages go to it until it
--    returns to the reception, the conversation is resolved or the contact
--    is silent for 24 h (`delegated_until` is pushed forward at each turn of
--    the specialist). The reference is composite with the workspace, so a
--    specialist of another workspace cannot be named. The engine updates
--    only these two columns besides the ones it already could.
-- 3. The `delegate` tool joins the factory orchestrator's template and the
--    orchestrators already created (their tools are locked to the customer);
--    `return_to_reception` joins the attendant and the seller. An
--    orchestrator that still has the factory prompt gets the new one; a
--    prompt the customer wrote is never replaced. The agents' tested
--    configuration is left as it was: an agent already on stays on and the
--    screen says the new version was not tested (A4b).
-- Owner app_migrations, ENABLE + FORCE RLS (lifted only for the data updates
-- below), no grants to anon/authenticated. No new policy: the columns follow
-- the policies of their tables (A2a, A2b).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Messages: who wrote it and how
-- ----------------------------------------------------------------------------
alter table public.ai_messages
  add column author_agent_id uuid references public.ai_agents(id) on delete set null,
  add column via_delegation boolean not null default false;

create index ai_messages_author_idx
  on public.ai_messages (author_agent_id) where author_agent_id is not null;

-- The author is a GUIDS of the conversation's workspace. It is read under
-- the caller's own policies: whoever writes the message already reads the
-- agent (the turn loads it first); a caller that cannot see it is refused.
create function private.ai_messages_check_author()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.author_agent_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.ai_agents agent
    join public.ai_conversations conversation on conversation.id = new.conversation_id
    where agent.id = new.author_agent_id
      and agent.kind = 'guid'
      and conversation.kind = 'guid'
      and agent.workspace_id is not distinct from conversation.workspace_id
  ) then
    raise exception 'ai messages: the author is not a GUIDS of the conversation workspace'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

alter function private.ai_messages_check_author() owner to app_migrations;
revoke execute on function private.ai_messages_check_author() from public, anon, authenticated;

create trigger ai_messages_check_author
  before insert on public.ai_messages
  for each row execute function private.ai_messages_check_author();

-- ----------------------------------------------------------------------------
-- 2. Conversation: who holds it now
-- ----------------------------------------------------------------------------
alter table public.ai_conversations
  add column delegated_agent_id uuid,
  add column delegated_until timestamptz,
  add constraint ai_conversations_delegation_check
    check (delegated_agent_id is null or (delegated_until is not null and kind = 'guid')),
  add constraint fk_ai_conversations_delegated
    foreign key (delegated_agent_id, workspace_id)
    references public.ai_agents(id, workspace_id) on delete set null (delegated_agent_id);

grant update (delegated_agent_id, delegated_until)
  on public.ai_conversations to app_runtime;

-- ----------------------------------------------------------------------------
-- 3. The tools and the orchestrator's prompt
-- ----------------------------------------------------------------------------
alter table public.ai_agent_templates no force row level security;
alter table public.ai_agents no force row level security;

-- Orchestrators still on the factory prompt take the new one (before the
-- template changes, so the old text is still there to compare).
update public.ai_agents agent
set config = jsonb_set(
  agent.config,
  '{overview,system_prompt}',
  to_jsonb($prompt$Você é {{agent_name}}, a recepção da empresa e o primeiro contato do cliente. Responda em {{language}}, com tom {{agent_tone}}. Se o cliente escrever em outro idioma, responda no idioma dele.

SOBRE O NEGÓCIO
Segmento: {{segment}}
Resumo: {{business_summary}}
Produtos e serviços: {{products_services}}
Horário de atendimento: {{availability_slots}}, fuso {{timezone}}.

COMO ATENDER
- Cumprimente, entenda o que o cliente precisa e faça uma pergunta por vez.
- Responda você mesmo o que é simples: horário, endereço, como funciona.
- Nunca invente preço, prazo ou disponibilidade.

QUANDO ENCAMINHAR (ferramenta delegate)
- Para o vendedor (seller): o cliente quer ver produtos ou serviços do Portfólio, comparar, comprar, reservar ou negociar.
- Para o atendente (attendant): o cliente quer orçamento, agendamento ou suporte, ou precisa de um atendimento mais longo.
- Escreva o resumo para o especialista (quem é o cliente, o que quer, o que já foi dito); o cliente não o vê. O especialista responde no seu lugar, logo em seguida: não escreva a resposta ao pedido.
- O cliente continua falando com você: não diga que mudou de pessoa nem cite o nome do especialista.
- Encaminhe uma vez por mensagem do cliente. Se a ferramenta não estiver disponível, responda você mesmo ou transfira para a equipe.

REGRAS
- Transferência para humano: {{handoff_mode}}
- Fora do horário: {{after_hours_behavior}}
- Fora do escopo: {{out_of_scope_action}}$prompt$::text),
  true
)
from public.ai_agent_templates template
where agent.factory_role = 'orchestrator'
  and agent.kind = 'guid'
  and template.factory_role = 'orchestrator'
  and agent.config #>> '{overview,system_prompt}' = template.prompt_template;

-- The tools of the factory agents already created.
update public.ai_agents agent
set config = jsonb_set(
  agent.config,
  '{integration,tools}',
  coalesce(agent.config #> '{integration,tools}', '[]'::jsonb) || to_jsonb('delegate'::text),
  true
)
where agent.factory_role = 'orchestrator'
  and agent.kind = 'guid'
  and not (coalesce(agent.config #> '{integration,tools}', '[]'::jsonb) @> '["delegate"]'::jsonb);

update public.ai_agents agent
set config = jsonb_set(
  agent.config,
  '{integration,tools}',
  coalesce(agent.config #> '{integration,tools}', '[]'::jsonb) || to_jsonb('return_to_reception'::text),
  true
)
where agent.factory_role in ('attendant', 'seller')
  and agent.kind = 'guid'
  and not (coalesce(agent.config #> '{integration,tools}', '[]'::jsonb) @> '["return_to_reception"]'::jsonb);

-- The factory templates: the new copies of the agents come with them.
update public.ai_agent_templates
set prompt_template = $prompt$Você é {{agent_name}}, a recepção da empresa e o primeiro contato do cliente. Responda em {{language}}, com tom {{agent_tone}}. Se o cliente escrever em outro idioma, responda no idioma dele.

SOBRE O NEGÓCIO
Segmento: {{segment}}
Resumo: {{business_summary}}
Produtos e serviços: {{products_services}}
Horário de atendimento: {{availability_slots}}, fuso {{timezone}}.

COMO ATENDER
- Cumprimente, entenda o que o cliente precisa e faça uma pergunta por vez.
- Responda você mesmo o que é simples: horário, endereço, como funciona.
- Nunca invente preço, prazo ou disponibilidade.

QUANDO ENCAMINHAR (ferramenta delegate)
- Para o vendedor (seller): o cliente quer ver produtos ou serviços do Portfólio, comparar, comprar, reservar ou negociar.
- Para o atendente (attendant): o cliente quer orçamento, agendamento ou suporte, ou precisa de um atendimento mais longo.
- Escreva o resumo para o especialista (quem é o cliente, o que quer, o que já foi dito); o cliente não o vê. O especialista responde no seu lugar, logo em seguida: não escreva a resposta ao pedido.
- O cliente continua falando com você: não diga que mudou de pessoa nem cite o nome do especialista.
- Encaminhe uma vez por mensagem do cliente. Se a ferramenta não estiver disponível, responda você mesmo ou transfira para a equipe.

REGRAS
- Transferência para humano: {{handoff_mode}}
- Fora do horário: {{after_hours_behavior}}
- Fora do escopo: {{out_of_scope_action}}$prompt$,
    version = version + 1
where factory_role = 'orchestrator';

update public.ai_agent_templates
set defaults = jsonb_set(defaults, '{overview,system_prompt}', to_jsonb(prompt_template))
where factory_role = 'orchestrator';

update public.ai_agent_templates
set defaults = jsonb_set(
  defaults,
  '{integration,tools}',
  (defaults #> '{integration,tools}') || to_jsonb('delegate'::text),
  true
)
where factory_role = 'orchestrator'
  and not ((defaults #> '{integration,tools}') @> '["delegate"]'::jsonb);

update public.ai_agent_templates
set defaults = jsonb_set(
      defaults,
      '{integration,tools}',
      (defaults #> '{integration,tools}') || to_jsonb('return_to_reception'::text),
      true
    ),
    version = version + 1
where factory_role in ('attendant', 'seller')
  and not ((defaults #> '{integration,tools}') @> '["return_to_reception"]'::jsonb);

alter table public.ai_agents force row level security;
alter table public.ai_agent_templates force row level security;

-- ----------------------------------------------------------------------------
-- 4. Who wrote an answer in the room, for the team's window only
-- ----------------------------------------------------------------------------
-- The room carries only the body (ADR 0023, rule 6; one persona, the
-- orchestrator's). The link `event_id` -> the specialist's role lives here,
-- per room, written by the turn right after it sends the answer and read by
-- the team's window ("Respondido pelo Vendedor"). It follows the room and
-- the workspace (cascades), so the purge of the WS1 takes it too.
create table public.inbox_guids_answers (
  room_id         text not null references public.matrix_rooms(room_id) on delete cascade,
  event_id        text not null check (length(event_id) between 2 and 255),
  workspace_id    uuid not null,
  organization_id uuid not null,
  role            text not null check (role in ('attendant', 'seller')),
  created_at      timestamptz not null default now(),
  primary key (room_id, event_id),
  constraint fk_inbox_guids_answers_workspace
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade
);

create index inbox_guids_answers_workspace_idx on public.inbox_guids_answers (workspace_id);

alter table public.inbox_guids_answers owner to app_migrations;
revoke all on public.inbox_guids_answers from public, anon, authenticated;
alter table public.inbox_guids_answers enable row level security;
alter table public.inbox_guids_answers force row level security;

create policy inbox_guids_answers_worker on public.inbox_guids_answers
  for all to app_worker using (true) with check (true);
grant select, insert, update, delete on public.inbox_guids_answers to app_worker;

-- Whoever has a level in the Inbox of the context workspace reads.
create policy inbox_guids_answers_select on public.inbox_guids_answers
  for select to app_runtime
  using (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and (select private.inbox_my_level()) is not null
  );

-- The turn runs as the person who chose the GUIDS (a manager of the Inbox),
-- for a room of the context workspace.
create policy inbox_guids_answers_insert on public.inbox_guids_answers
  for insert to app_runtime
  with check (
    workspace_id = private.context_uuid('app.workspace_id')
    and organization_id = private.context_uuid('app.organization_id')
    and private.inbox_my_manages()
    and exists (
      select 1 from public.matrix_rooms room
      where room.room_id = inbox_guids_answers.room_id
        and room.workspace_id = inbox_guids_answers.workspace_id
    )
  );

grant select on public.inbox_guids_answers to app_runtime;
grant insert (room_id, event_id, workspace_id, organization_id, role)
  on public.inbox_guids_answers to app_runtime;
