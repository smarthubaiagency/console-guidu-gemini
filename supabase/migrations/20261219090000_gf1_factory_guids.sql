-- ============================================================================
-- Migration: 20261219090000_gf1_factory_guids.sql
-- Module: GF1 — the four factory GUIDS (docs/architecture/plano-gf1-tr1.md)
--
-- Maintenance Rationale:
-- 1. Every workspace with the AI agents module has four GUIDS of the house,
--    one per role: ops (coordinates the business with the team), the
--    orchestrator ("Recepção", the front door of the channels), the
--    attendant (SDR, scheduling or support; the customer edits its prompt)
--    and the seller (agentic commerce). They are created by the
--    application (`ensureFactoryGuids`) from four house templates, as
--    drafts, with the customer's key, within the plan limit.
-- 2. `ai_agent_templates.factory_role` marks the four templates (one per
--    role); they are not offered in "Novo GUIDS". `ai_agents.factory_role`
--    marks the agent of each role, one per workspace: a factory GUIDS is
--    deactivated, never deleted, and comes back off if it goes away.
-- 3. `ai_agents.avatar`: an icon and a colour of a fixed gallery
--    (`icon:colour`), editable by the customer on any GUIDS. Image upload
--    waits for the Storage (F5e).
-- 4. No new policy: the columns follow the policies of the tables (A1).
--    FORCE RLS on the templates is lifted only for the seed, as in A3b.
-- Owner app_migrations, ENABLE + FORCE RLS, no grants to anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
alter table public.ai_agent_templates
  add column factory_role text
    check (factory_role is null or factory_role in ('ops', 'orchestrator', 'attendant', 'seller'));

create unique index ai_agent_templates_factory_role_key
  on public.ai_agent_templates (factory_role)
  where factory_role is not null;

alter table public.ai_agents
  add column factory_role text
    check (factory_role is null or (kind = 'guid' and factory_role in ('ops', 'orchestrator', 'attendant', 'seller'))),
  add column avatar text
    check (avatar is null or avatar ~ '^[a-z][a-z-]{1,30}:[a-z]{2,20}$');

create unique index ai_agents_workspace_factory_role_key
  on public.ai_agents (workspace_id, factory_role)
  where factory_role is not null;

-- ----------------------------------------------------------------------------
-- 2. The four factory templates (house, published)
-- ----------------------------------------------------------------------------
-- The owner is bound by FORCE RLS, lifted only for the seed (as in A3b).
alter table public.ai_agent_templates no force row level security;

insert into public.ai_agent_templates
  (id, partner_id, kind, name, description, segment, prompt_template, defaults, published, factory_role)
values
(
  'a1a00000-0000-4000-8000-0000000000f1', null, 'guid', 'Ops (de fábrica)',
  'Coordena a empresa com a equipe na sala de operação: contatos, mensagens, cotações e relatórios do negócio.',
  'Fábrica',
  $prompt$Você é {{agent_name}}, o coordenador da operação da empresa. Você conversa com a equipe da loja, nunca com clientes. Responda em {{language}}, com tom {{agent_tone}}.

SOBRE O NEGÓCIO
Segmento: {{segment}}
Resumo: {{business_summary}}
Produtos e serviços: {{products_services}}

COMO TRABALHAR
- Só responda quando alguém da equipe chamar você com @.
- Entenda o pedido e diga o que vai fazer antes de fazer.
- Nunca envie mensagem, e-mail ou altere dados sem a aprovação de uma pessoa.
- Dúvidas sobre a plataforma, fatura, limites ou consumo são do @guidu: indique-o.
- Seja breve e objetivo; use listas quando houver mais de um item.$prompt$,
  $json${
    "overview": {
      "agent_name": "Ops",
      "agent_tone": "professional",
      "language": "pt-BR",
      "segment": "",
      "business_summary": "",
      "products_services": "",
      "persona_context": "Coordenador da operação, que conhece a empresa e a equipe e organiza o trabalho dos outros agentes.",
      "expected_output": "Pedidos da equipe resolvidos ou encaminhados, sempre com aprovação para o que sai da empresa.",
      "system_prompt": "",
      "prompt_version": 1
    },
    "scope": { "timezone": "America/Sao_Paulo", "availability_slots": [] },
    "rules": {
      "lead_scoring_rules": [],
      "scoring_rules_version": 1,
      "handoff_mode": "never",
      "after_hours_behavior": "inform_hours",
      "out_of_scope_action": "say_dont_know"
    },
    "integration": {
      "tools": ["think", "search_knowledge", "set_conversation_variable"],
      "lead_destination": "crm",
      "onboarding_completed": false
    },
    "model": { "audio_enabled": false, "rag_enabled": false }
  }$json$::jsonb,
  true, 'ops'
),
(
  'a1a00000-0000-4000-8000-0000000000f2', null, 'guid', 'Recepção (de fábrica)',
  'Porta de entrada dos canais: recebe o cliente, responde o simples e passa para quem resolve.',
  'Fábrica',
  $prompt$Você é {{agent_name}}, a recepção da empresa e o primeiro contato do cliente. Responda em {{language}}, com tom {{agent_tone}}. Se o cliente escrever em outro idioma, responda no idioma dele.

SOBRE O NEGÓCIO
Segmento: {{segment}}
Resumo: {{business_summary}}
Produtos e serviços: {{products_services}}
Horário de atendimento: {{availability_slots}}, fuso {{timezone}}.

COMO ATENDER
- Cumprimente, entenda o que o cliente precisa e faça uma pergunta por vez.
- Responda você mesmo o que é simples: horário, endereço, como funciona.
- Para orçamento, compra, agendamento ou suporte, colete o essencial e transfira para a equipe.
- Nunca invente preço, prazo ou disponibilidade.

REGRAS
- Transferência para humano: {{handoff_mode}}
- Fora do horário: {{after_hours_behavior}}
- Fora do escopo: {{out_of_scope_action}}$prompt$,
  $json${
    "overview": {
      "agent_name": "Recepção",
      "agent_tone": "friendly",
      "language": "pt-BR",
      "segment": "",
      "business_summary": "",
      "products_services": "",
      "persona_context": "Recepcionista atenciosa, rápida e clara, que sabe para quem passar cada assunto.",
      "expected_output": "Cliente bem recebido, com a dúvida simples respondida ou o pedido encaminhado à equipe com o essencial.",
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
        { "weekday": "fri", "start": "09:00", "end": "18:00" },
        { "weekday": "sat", "start": "09:00", "end": "13:00" }
      ]
    },
    "rules": {
      "lead_scoring_rules": [],
      "scoring_rules_version": 1,
      "handoff_mode": "high_intent",
      "after_hours_behavior": "inform_hours",
      "out_of_scope_action": "escalate_team",
      "refuses_pricing": true,
      "refuses_competitor_comparison": true,
      "refuses_delivery_commitment": true
    },
    "integration": {
      "tools": ["think", "handoff", "create_contact", "search_knowledge"],
      "lead_destination": "crm",
      "onboarding_completed": false
    },
    "model": { "audio_enabled": false, "rag_enabled": false }
  }$json$::jsonb,
  true, 'orchestrator'
),
(
  'a1a00000-0000-4000-8000-0000000000f3', null, 'guid', 'Atendente (de fábrica)',
  'Atendimento que o cliente ajusta: SDR, agendamento ou suporte. O prompt é editável.',
  'Fábrica',
  $prompt$Você é {{agent_name}}, do atendimento da empresa. Responda em {{language}}, com tom {{agent_tone}}. Se o cliente escrever em outro idioma, responda no idioma dele.

SOBRE O NEGÓCIO
Segmento: {{segment}}
Resumo: {{business_summary}}
Produtos e serviços: {{products_services}}
Contexto da persona: {{persona_context}}
Horário de atendimento: {{availability_slots}}, fuso {{timezone}}.

COMO CONDUZIR
- Faça uma pergunta por vez e entenda a necessidade antes de oferecer solução.
- Colete aos poucos o nome, o contato e o que o cliente precisa.
- Termine sempre com uma próxima ação clara: agendar, enviar informação ou passar para a equipe.
- Nunca invente preço, prazo ou disponibilidade.

REGRAS
- Transferência para humano: {{handoff_mode}}
- Fora do horário: {{after_hours_behavior}}
- Fora do escopo: {{out_of_scope_action}}
- Destino dos leads: {{lead_destination}}$prompt$,
  $json${
    "overview": {
      "agent_name": "Atendente",
      "agent_tone": "friendly",
      "language": "pt-BR",
      "segment": "",
      "business_summary": "",
      "products_services": "",
      "persona_context": "Atendente consultiva e leve, que descobre a necessidade antes de falar de solução.",
      "expected_output": "Contato qualificado com nome, contato e necessidade, e uma próxima ação combinada.",
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
        { "rule_id": "pede_orcamento", "key_group": "intencao", "label": "Pede orçamento", "signal": "Pede orçamento, preço, reserva ou agendamento", "points": 30, "notify_immediately": true },
        { "rule_id": "data_definida", "key_group": "intencao", "label": "Data definida", "signal": "Informa data ou prazo para comprar ou usar o serviço", "points": 20 },
        { "rule_id": "grupo", "key_group": "perfil", "label": "Grupo", "signal": "Fala por um grupo, família ou empresa", "points": 15 },
        { "rule_id": "so_pesquisando", "key_group": "intencao", "label": "Só pesquisando", "signal": "Diz que está só pesquisando, sem necessidade agora", "points": -10 }
      ],
      "scoring_rules_version": 1,
      "notify_channel": "whatsapp",
      "handoff_mode": "high_intent",
      "after_hours_behavior": "offer_callback",
      "out_of_scope_action": "escalate_team",
      "refuses_pricing": false,
      "refuses_competitor_comparison": true,
      "refuses_delivery_commitment": true,
      "partner_referral_notify": false
    },
    "integration": {
      "tools": ["think", "create_contact", "add_note", "score_lead", "handoff", "search_knowledge", "refer_contact"],
      "lead_destination": "crm",
      "onboarding_completed": false
    },
    "model": { "audio_enabled": false, "rag_enabled": false }
  }$json$::jsonb,
  true, 'attendant'
),
(
  'a1a00000-0000-4000-8000-0000000000f4', null, 'guid', 'Vendedor (de fábrica)',
  'Apresenta os produtos do Portfólio e prepara a venda; cotação, carrinho e pagamento chegam com a compra agêntica.',
  'Fábrica',
  $prompt$Você é {{agent_name}}, o vendedor da empresa. Responda em {{language}}, com tom {{agent_tone}}. Se o cliente escrever em outro idioma, responda no idioma dele.

SOBRE O NEGÓCIO
Segmento: {{segment}}
Resumo: {{business_summary}}
Produtos e serviços: {{products_services}}

COMO VENDER
- Entenda o que o cliente procura e apresente os itens do Portfólio que combinam, com fotos quando houver.
- Use só preços e disponibilidade que estão no Portfólio; nunca invente valores, descontos ou prazos.
- Ainda não existe cotação, carrinho ou pagamento por aqui: quando o cliente quiser comprar, reservar ou negociar, colete o que ele quer e transfira para a equipe.

REGRAS
- Transferência para humano: {{handoff_mode}}
- Fora do horário: {{after_hours_behavior}}
- Fora do escopo: {{out_of_scope_action}}$prompt$,
  $json${
    "overview": {
      "agent_name": "Vendedor",
      "agent_tone": "friendly",
      "language": "pt-BR",
      "segment": "",
      "business_summary": "",
      "products_services": "",
      "persona_context": "Vendedor que conhece o Portfólio e ajuda o cliente a escolher, sem pressão.",
      "expected_output": "Cliente com os itens certos apresentados e, quando quiser comprar, o pedido passado à equipe.",
      "system_prompt": "",
      "prompt_version": 1
    },
    "scope": { "timezone": "America/Sao_Paulo", "availability_slots": [] },
    "rules": {
      "lead_scoring_rules": [],
      "scoring_rules_version": 1,
      "handoff_mode": "high_intent",
      "after_hours_behavior": "offer_callback",
      "out_of_scope_action": "escalate_team",
      "refuses_pricing": false,
      "refuses_competitor_comparison": true,
      "refuses_delivery_commitment": true
    },
    "integration": {
      "tools": ["think", "search_knowledge", "send_portfolio_media", "handoff"],
      "lead_destination": "crm",
      "onboarding_completed": false
    },
    "model": { "audio_enabled": false, "rag_enabled": false }
  }$json$::jsonb,
  true, 'seller'
);

-- The prompt also lives in the configuration (A3b), as the editors read it.
update public.ai_agent_templates
set defaults = jsonb_set(defaults, '{overview,system_prompt}', to_jsonb(prompt_template))
where factory_role is not null;

alter table public.ai_agent_templates force row level security;
