-- ============================================================================
-- Migration: 20261102090000_a3b_ai_prompts.sql
-- Module: A3b — The prompt of the templates inside their configuration
--         (especificação v1.0 §4 and §5.1; plano-a3.md)
--
-- Maintenance Rationale:
-- 1. The templates seeded in the A1 keep their prompt only in
--    `prompt_template`, and `defaults.overview.system_prompt` is empty. The
--    engine reads the agent's `system_prompt` (campos.md §8, rule 5), so the
--    Assistant of every partner, copied from the admin template, has no
--    prompt and cannot answer. From the A3a on, the editor keeps both
--    fields equal; here the stored templates get the same.
-- 2. The Assistants that still have no prompt receive the one of their
--    template. A prompt already written is never replaced.
-- Data only: no table, policy or grant changes. The owner is bound by FORCE
-- RLS, lifted only for these two updates.
-- ============================================================================

-- Both tables are read with RLS lifted: the agents' update reads the
-- templates too.
alter table public.ai_agent_templates no force row level security;
alter table public.ai_agents no force row level security;

update public.ai_agent_templates
set defaults = jsonb_set(
  defaults,
  '{overview}',
  coalesce(defaults -> 'overview', '{}'::jsonb)
    || jsonb_build_object('system_prompt', prompt_template),
  true
)
where btrim(prompt_template) <> ''
  and btrim(coalesce(defaults #>> '{overview,system_prompt}', '')) = '';

update public.ai_agents agent
set config = jsonb_set(
  agent.config,
  '{overview}',
  coalesce(agent.config -> 'overview', '{}'::jsonb)
    || jsonb_build_object('system_prompt', template.prompt_template),
  true
)
from public.ai_agent_templates template
where agent.kind = 'assistant'
  and template.id = agent.template_id
  and btrim(template.prompt_template) <> ''
  and btrim(coalesce(agent.config #>> '{overview,system_prompt}', '')) = '';

alter table public.ai_agents force row level security;
alter table public.ai_agent_templates force row level security;
