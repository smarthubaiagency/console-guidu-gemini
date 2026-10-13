import type { z } from "zod";

import type { AgentConfig } from "./schema";

/**
 * Who edits which field of the configuration (especificação §5.2 and
 * campos.md, column "Editável por"), shared by the editor, which shows only
 * the fields the person may change, and by the services, which refuse any
 * other change. The editors:
 *
 * - `template`: the owner of a template (the house in `/platform`, a
 *   partner in `/admin`): every field but the key, which is the
 *   workspace's or the partner's, never the template's;
 * - `partner`: the partner editing a customer's GUIDS;
 * - `assistant`: the partner editing its GUIDU Assistant (§4): name,
 *   instructions and the model connection; the tools and the rest stay as
 *   the house's admin template defines them;
 * - `customer`: the customer with a GUIDS that follows its template: the
 *   model connection only;
 * - `customer_custom`: the customer with a customized GUIDS: everything but
 *   the tools, the expected output and the leads' destination.
 *
 * The version fields are the system's: they go up when the prompt or the
 * scoring rules change. The provider comes from the chosen key, except in
 * a template, which has no key.
 */

export type ConfigEditor =
  "template" | "partner" | "assistant" | "customer" | "customer_custom";

export const CONFIG_TABS = [
  "overview",
  "scope",
  "rules",
  "integration",
  "model",
] as const;

export type ConfigTab = (typeof CONFIG_TABS)[number];

export const CONFIG_FIELDS = {
  overview: [
    "agent_name",
    "agent_tone",
    "language",
    "segment",
    "business_summary",
    "products_services",
    "persona_context",
    "expected_output",
    "system_prompt",
    "prompt_version",
    "variables",
  ],
  scope: [
    "base_city",
    "base_state",
    "remote_allowed",
    "travel_allowed",
    "coverage_areas",
    "coverage_cities",
    "coverage_radius_km",
    "timezone",
    "availability_slots",
  ],
  rules: [
    "hot_score_threshold",
    "warm_score_threshold",
    "notify_on_score",
    "lead_scoring_rules",
    "scoring_rules_version",
    "owner_phone",
    "notify_channel",
    "notify_template",
    "handoff_mode",
    "after_hours_behavior",
    "out_of_scope_action",
    "refuses_pricing",
    "refuses_competitor_comparison",
    "refuses_delivery_commitment",
    "partner_referral_notify",
    "partner_message_template",
  ],
  integration: [
    "tools",
    "lead_destination",
    "crm_webhook_url",
    "onboarding_completed",
  ],
  model: [
    "credential_id",
    "model_provider",
    "model_name",
    "audio_enabled",
    "audio_model",
    "audio_voice",
    "rag_enabled",
    "embedding_model",
  ],
} as const satisfies Record<ConfigTab, readonly string[]>;

const SYSTEM_FIELDS = new Set([
  "overview.prompt_version",
  "rules.scoring_rules_version",
]);
/** The model connection of the Assistant: a text chat in the panel. */
const ASSISTANT_MODEL = new Set([
  "model.credential_id",
  "model.model_name",
  "model.rag_enabled",
  "model.embedding_model",
]);
/** Never the customer's, even when customized (campos.md, "P" only). */
const PARTNER_ONLY = new Set(["overview.expected_output"]);

const ALL_FIELDS: readonly string[] = CONFIG_TABS.flatMap((tab) =>
  CONFIG_FIELDS[tab].map((field) => `${tab}.${field}`),
);

/** The fields, as `tab.field`, that the editor may change. */
export function editableFields(editor: ConfigEditor): ReadonlySet<string> {
  return new Set(
    ALL_FIELDS.filter((path) => {
      if (SYSTEM_FIELDS.has(path)) return false;
      const tab = path.slice(0, path.indexOf("."));
      switch (editor) {
        case "template":
          return path !== "model.credential_id";
        case "partner":
          return path !== "model.model_provider";
        case "assistant":
          return tab === "overview" || ASSISTANT_MODEL.has(path);
        case "customer":
          return tab === "model" && path !== "model.model_provider";
        case "customer_custom":
          return (
            tab !== "integration" &&
            !PARTNER_ONLY.has(path) &&
            path !== "model.model_provider"
          );
      }
    }),
  );
}

/** The tabs with at least one field the editor may change. */
export function editableTabs(editor: ConfigEditor): readonly ConfigTab[] {
  const fields = editableFields(editor);
  return CONFIG_TABS.filter((tab) =>
    CONFIG_FIELDS[tab].some((field) => fields.has(`${tab}.${field}`)),
  );
}

type Doc = Record<ConfigTab, Record<string, unknown>>;

function tabOf(raw: unknown, tab: string): Record<string, unknown> {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)[tab]
      : undefined;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Structural equality of JSON values, whatever the order of the keys. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = Object.entries(a).filter(([, v]) => v !== undefined);
    const right = Object.entries(b).filter(([, v]) => v !== undefined);
    return (
      left.length === right.length &&
      left.every(([key, value]) =>
        sameValue(value, (b as Record<string, unknown>)[key]),
      )
    );
  }
  return false;
}

export type ConfigEdit = Readonly<{
  /** The new document, still to be validated by `parseAgentConfig`. */
  config: Doc;
  /** Fields, as `tab.field`, whose value changed. */
  changed: readonly string[];
  /** Fields the editor tried to change without being allowed. */
  forbidden: readonly string[];
}>;

/**
 * Applies the document the editor sent over the current one: the fields
 * the editor may change come from the submission (absent means cleared),
 * every other field keeps its current value. A different value in a field
 * outside the editor's division is reported in `forbidden`, for the
 * service to refuse. The versions go up with the prompt and the rules.
 */
export function applyConfigEdit(
  current: unknown,
  submitted: unknown,
  editor: ConfigEditor,
): ConfigEdit {
  const fields = editableFields(editor);
  const config = {} as Doc;
  const changed: string[] = [];
  const forbidden: string[] = [];

  for (const tab of CONFIG_TABS) {
    const before = tabOf(current, tab);
    const sent = tabOf(submitted, tab);
    const next: Record<string, unknown> = {};
    for (const field of CONFIG_FIELDS[tab]) {
      const path = `${tab}.${field}`;
      const old = before[field];
      const value = fields.has(path) ? sent[field] : old;
      if (!fields.has(path) && field in sent && !sameValue(sent[field], old)) {
        // The provider follows the key: the service sets it.
        if (!SYSTEM_FIELDS.has(path) && path !== "model.model_provider") {
          forbidden.push(path);
        }
      }
      if (value !== undefined) next[field] = value;
      if (!sameValue(value, old)) changed.push(path);
    }
    config[tab] = next;
  }

  const overview = config.overview;
  if (changed.includes("overview.system_prompt")) {
    overview.prompt_version = nextVersion(
      tabOf(current, "overview"),
      "prompt_version",
    );
  }
  const rules = config.rules;
  if (changed.includes("rules.lead_scoring_rules")) {
    rules.scoring_rules_version = nextVersion(
      tabOf(current, "rules"),
      "scoring_rules_version",
    );
  }
  return { config, changed, forbidden };
}

function nextVersion(tab: Record<string, unknown>, field: string): number {
  const value = tab[field];
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value + 1
    : 2;
}

/** The first message of each invalid field, by `tab.field[.index…]`. */
export function configFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".") || "config";
    if (!(path in errors)) errors[path] = issue.message;
  }
  return errors;
}

/**
 * Minimum fields for an agent to be tested or activated (campos.md §9;
 * for the Assistant, its name, language, tone, prompt and model),
 * as `tab.field`. Empty means ready. A template is never tested: the key
 * is the agent's, so `template` skips the model connection.
 */
export function missingConfigFields(
  config: AgentConfig,
  editor: ConfigEditor,
): string[] {
  const missing: string[] = [];
  const blank = (value: string | undefined) => !value || !value.trim();
  const { overview, scope, rules, model } = config;
  if (blank(overview.agent_name)) missing.push("overview.agent_name");
  if (!overview.language) missing.push("overview.language");
  if (!overview.agent_tone) missing.push("overview.agent_tone");
  if (blank(overview.system_prompt)) missing.push("overview.system_prompt");
  // The Assistant answers in the panel: no business, hours nor lead rules.
  if (editor !== "assistant") {
    if (blank(overview.business_summary)) {
      missing.push("overview.business_summary");
    }
    if (blank(overview.products_services)) {
      missing.push("overview.products_services");
    }
    if (!scope.timezone) missing.push("scope.timezone");
    if (!scope.availability_slots?.length) {
      missing.push("scope.availability_slots");
    }
    if (!rules.handoff_mode) missing.push("rules.handoff_mode");
    if (!rules.after_hours_behavior) missing.push("rules.after_hours_behavior");
    if (!rules.out_of_scope_action) missing.push("rules.out_of_scope_action");
  }
  if (editor !== "template") {
    if (!model.credential_id) missing.push("model.credential_id");
    if (blank(model.model_name)) missing.push("model.model_name");
  }
  return missing;
}
