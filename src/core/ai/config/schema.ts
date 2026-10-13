import { z } from "zod";

import { AGENT_TOOL_IDS, type AgentKind, toolAllowedFor } from "./tools";

/**
 * Configuration document of an agent and of a template, version 1
 * (campos.md). One object per editor tab, with the field names of the
 * legacy in snake_case, as the prompt tags use them. Stored in
 * `ai_agents.config` and `ai_agent_templates.defaults`, with the version in
 * `config_version`.
 *
 * Every field is optional: a draft can be saved incomplete, and the screens
 * show what is missing before testing or activating (campos.md §9). Unknown
 * fields are refused, so a typo never becomes a silent setting. A new field
 * means a new version and a migration of the stored documents.
 */

export const CURRENT_CONFIG_VERSION = 1;

/** One set of values per field, used by screens, database and prompt (§7). */
export const AGENT_TONES = [
  "professional",
  "friendly",
  "technical",
  "casual",
] as const;
export const AGENT_LANGUAGES = ["pt-BR", "en-US", "es"] as const;
export const HANDOFF_MODES = ["high_intent", "always_ask", "never"] as const;
export const AFTER_HOURS_BEHAVIORS = [
  "offer_callback",
  "inform_hours",
  "auto_reply_only",
] as const;
export const OUT_OF_SCOPE_ACTIONS = ["escalate_team", "say_dont_know"] as const;
export const NOTIFY_CHANNELS = ["whatsapp", "email", "sms"] as const;
export const LEAD_DESTINATIONS = ["crm", "webhook", "both"] as const;
export const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
] as const;
export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

const text = (max: number) => z.string().trim().max(max);
const texts = (max: number, items = 100) => z.array(text(max)).max(items);
const score = z.number().int().min(-100_000).max(100_000);
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use o formato HH:MM." });

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const OverviewTab = z.strictObject({
  agent_name: text(80).optional(),
  agent_tone: z.enum(AGENT_TONES).optional(),
  language: z.enum(AGENT_LANGUAGES).optional(),
  segment: text(80).optional(),
  business_summary: text(5000).optional(),
  products_services: text(10_000).optional(),
  persona_context: text(5000).optional(),
  expected_output: text(5000).optional(),
  system_prompt: z.string().max(50_000).optional(),
  prompt_version: z.number().int().min(1).optional(),
});

const AvailabilitySlot = z
  .strictObject({ weekday: z.enum(WEEKDAYS), start: time, end: time })
  .refine((slot) => slot.start < slot.end, {
    error: "O horário final deve ser depois do inicial.",
  });

const ScopeTab = z.strictObject({
  base_city: text(120).optional(),
  base_state: text(60).optional(),
  remote_allowed: z.boolean().optional(),
  travel_allowed: z.boolean().optional(),
  coverage_areas: texts(120).optional(),
  coverage_cities: texts(120).optional(),
  coverage_radius_km: z.number().int().min(0).max(20_000).nullable().optional(),
  timezone: z
    .string()
    .refine(isTimeZone, { error: "Fuso horário inválido." })
    .optional(),
  availability_slots: z.array(AvailabilitySlot).max(50).optional(),
});

export const ScoringRuleSchema = z.strictObject({
  rule_id: z
    .string()
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
    .max(60),
  key_group: text(60),
  label: text(120).min(1, { error: "Informe o nome da regra." }),
  signal: text(500).min(1, { error: "Informe o sinal da regra." }),
  points: z.number().int().min(-100).max(100),
  capture_field: text(80).optional(),
  notify_immediately: z.boolean().optional(),
});

const RulesTab = z
  .strictObject({
    hot_score_threshold: score.optional(),
    warm_score_threshold: score.optional(),
    notify_on_score: score.optional(),
    lead_scoring_rules: z
      .array(ScoringRuleSchema)
      .max(100)
      .refine(
        (rules) => new Set(rules.map((r) => r.rule_id)).size === rules.length,
        { error: "Regras de pontuação com o mesmo identificador." },
      )
      .optional(),
    scoring_rules_version: z.number().int().min(1).optional(),
    owner_phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, {
        error: "Use o telefone com DDI, como +5511999990000.",
      })
      .optional(),
    notify_channel: z.enum(NOTIFY_CHANNELS).optional(),
    notify_template: text(2000).optional(),
    handoff_mode: z.enum(HANDOFF_MODES).optional(),
    after_hours_behavior: z.enum(AFTER_HOURS_BEHAVIORS).optional(),
    out_of_scope_action: z.enum(OUT_OF_SCOPE_ACTIONS).optional(),
    refuses_pricing: z.boolean().optional(),
    refuses_competitor_comparison: z.boolean().optional(),
    refuses_delivery_commitment: z.boolean().optional(),
    partner_referral_notify: z.boolean().optional(),
    partner_message_template: text(2000).optional(),
  })
  .refine(
    (rules) =>
      rules.hot_score_threshold === undefined ||
      rules.warm_score_threshold === undefined ||
      rules.hot_score_threshold > rules.warm_score_threshold,
    {
      error: "O limiar de lead quente deve ser maior que o de morno.",
      path: ["hot_score_threshold"],
    },
  );

const IntegrationTab = z
  .strictObject({
    tools: z
      .array(z.enum(AGENT_TOOL_IDS))
      .max(AGENT_TOOL_IDS.length)
      .refine((tools) => new Set(tools).size === tools.length, {
        error: "Ferramenta repetida.",
      })
      .optional(),
    lead_destination: z.enum(LEAD_DESTINATIONS).optional(),
    // SSRF checks of the address come with the delivery of leads (A6).
    crm_webhook_url: z
      .url({ protocol: /^https$/, error: "Use um endereço https://." })
      .max(2000)
      .optional(),
    onboarding_completed: z.boolean().optional(),
  })
  .refine(
    (tab) =>
      tab.lead_destination === undefined ||
      tab.lead_destination === "crm" ||
      tab.crm_webhook_url !== undefined,
    {
      error: "Informe o endereço do webhook.",
      path: ["crm_webhook_url"],
    },
  );

const ModelTab = z.strictObject({
  // A credential of the workspace vault (GUIDS) or of the partner (Assistant).
  credential_id: z.uuid().nullable().optional(),
  model_provider: z.enum(MODEL_PROVIDERS).optional(),
  model_name: text(120).optional(),
  audio_enabled: z.boolean().optional(),
  audio_model: text(120).optional(),
  audio_voice: text(120).optional(),
  rag_enabled: z.boolean().optional(),
  embedding_model: text(120).optional(),
});

export const AgentConfigV1 = z.strictObject({
  overview: OverviewTab.prefault({}),
  scope: ScopeTab.prefault({}),
  rules: RulesTab.prefault({}),
  integration: IntegrationTab.prefault({}),
  model: ModelTab.prefault({}),
});

export type AgentConfig = z.output<typeof AgentConfigV1>;

/** Kind of the agents a template creates. */
export function agentKindOfTemplate(kind: "admin" | "guid"): AgentKind {
  return kind === "admin" ? "assistant" : "guid";
}

export type AgentConfigParse =
  | Readonly<{ success: true; data: AgentConfig }>
  | Readonly<{ success: false; error: z.ZodError }>;

/**
 * Validates a configuration document of the given version for an agent
 * kind: the tools must be available to that kind (§8).
 */
export function parseAgentConfig(
  kind: AgentKind,
  version: number,
  raw: unknown,
): AgentConfigParse {
  if (version !== CURRENT_CONFIG_VERSION) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: [],
          input: version,
          message: `Versão de configuração não suportada: ${version}.`,
        },
      ]),
    };
  }
  return AgentConfigV1.superRefine((config, ctx) => {
    for (const [index, tool] of (config.integration.tools ?? []).entries()) {
      if (!toolAllowedFor(tool, kind)) {
        ctx.addIssue({
          code: "custom",
          path: ["integration", "tools", index],
          message: `A ferramenta ${tool} não está disponível para este agente.`,
        });
      }
    }
  }).safeParse(raw);
}
