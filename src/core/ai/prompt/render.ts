import type { AgentConfig } from "../config/schema";
import type { AgentKind } from "../config/tools";
import {
  format,
  type PromptLocale,
  promptTexts,
  type PromptTexts,
} from "./texts";
import { type ContextValues, isContextVariable } from "./variables";

/**
 * The single prompt renderer of the engine (campos.md §8, variaveis.md §3),
 * used by "Testar agente" and by production alike:
 *
 * - the 25 flat tags of the legacy (`{{agent_name}}`), from the agent's
 *   configuration;
 * - `{{namespace.key}}` from the turn's context, `{{agent.var.key}}` from
 *   the agent's variables and `{{conversation.var.key}}` from the memory.
 *
 * One pass: a value put in the text is never read again, so no value can
 * open a new tag. An unknown tag stays as it is. An empty field becomes
 * "(nao configurado)"; a missing variable, "(não informado)". Data of the
 * contact and of the conversation is untrusted: it is cut to a short size,
 * loses its braces and goes, in full, only in a separate block.
 */

export const CONFIG_TAGS = [
  "agent_name",
  "business_summary",
  "segment",
  "products_services",
  "persona_context",
  "language",
  "agent_tone",
  "base_city",
  "base_state",
  "timezone",
  "coverage_radius_km",
  "coverage_cities",
  "coverage_areas",
  "remote_allowed",
  "travel_allowed",
  "availability_slots",
  "refuses_pricing",
  "refuses_competitor_comparison",
  "refuses_delivery_commitment",
  "partner_referral_notify",
  "partner_message_template",
  "handoff_mode",
  "after_hours_behavior",
  "out_of_scope_action",
  "lead_destination",
] as const;

export type ConfigTag = (typeof CONFIG_TAGS)[number];

const TAGS: ReadonlySet<string> = new Set(CONFIG_TAGS);
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Longest untrusted value inside the instructions. */
export const MAX_UNTRUSTED_INLINE = 300;
/** Longest untrusted value in the data blocks. */
export const MAX_UNTRUSTED_BLOCK = 2000;

const TAG = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\s*\}\}/g;

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function yesNo(value: boolean, texts: PromptTexts): string {
  return value ? texts.yes : texts.no;
}

/** Untrusted text: no braces, one size, never a new tag. */
export function untrusted(value: unknown, max: number): string {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value ?? "");
  const clean = text.replace(/[{}]/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * "seg-sex: 09:00 às 18:00; sáb: 09:00 às 12:00": days with the same
 * hours together, consecutive days as a range (campos.md §8, rule 4).
 */
export function renderAvailability(
  slots: AgentConfig["scope"]["availability_slots"],
  texts: PromptTexts,
): string {
  if (!slots || slots.length === 0) return texts.noHours;
  const byHours = new Map<string, Set<number>>();
  for (const slot of slots) {
    const key = `${slot.start}-${slot.end}`;
    const days = byHours.get(key) ?? new Set<number>();
    days.add(WEEK.indexOf(slot.weekday));
    byHours.set(key, days);
  }
  const groups = [...byHours.entries()].map(([hours, days]) => {
    const sorted = [...days].sort((a, b) => a - b);
    const runs: number[][] = [];
    for (const day of sorted) {
      const last = runs.at(-1);
      if (last && last.at(-1) === day - 1) last.push(day);
      else runs.push([day]);
    }
    const name = (day: number) => texts.weekdays[WEEK[day]!] ?? WEEK[day]!;
    const label = runs
      .map((run) =>
        run.length === 1
          ? name(run[0]!)
          : `${name(run[0]!)}-${name(run.at(-1)!)}`,
      )
      .join(", ");
    const [start, end] = hours.split("-");
    return {
      first: sorted[0]!,
      text: `${label}: ${format(texts.hours, { start: start!, end: end! })}`,
    };
  });
  return groups
    .sort((a, b) => a.first - b.first)
    .map((g) => g.text)
    .join("; ");
}

/** The text of one configuration tag (campos.md §8). */
export function renderConfigTag(
  tag: ConfigTag,
  config: AgentConfig,
  texts: PromptTexts,
): string {
  const { overview, scope, rules, integration } = config;
  const plain = (value: unknown): string =>
    isEmpty(value) ? texts.notConfigured : String(value);
  const list = (value: readonly string[] | undefined): string =>
    isEmpty(value) ? texts.notConfigured : value!.join(", ");
  const bool = (value: boolean | undefined): string =>
    value === undefined ? texts.notConfigured : yesNo(value, texts);
  const behavior = (
    value: string | undefined,
    labels: Readonly<Record<string, string>>,
  ): string =>
    isEmpty(value) ? texts.notConfigured : (labels[value!] ?? value!);

  switch (tag) {
    case "agent_name":
    case "business_summary":
    case "segment":
    case "products_services":
    case "persona_context":
    case "language":
    case "agent_tone":
      return plain(overview[tag]);
    case "base_city":
    case "base_state":
    case "timezone":
    case "coverage_radius_km":
      return plain(scope[tag]);
    case "coverage_cities":
    case "coverage_areas":
      return list(scope[tag]);
    case "remote_allowed":
    case "travel_allowed":
      return bool(scope[tag]);
    case "availability_slots":
      return renderAvailability(scope.availability_slots, texts);
    case "refuses_pricing":
    case "refuses_competitor_comparison":
    case "refuses_delivery_commitment":
    case "partner_referral_notify":
      return bool(rules[tag]);
    case "partner_message_template":
      return plain(rules.partner_message_template);
    case "handoff_mode":
      return behavior(rules.handoff_mode, texts.handoffMode);
    case "after_hours_behavior":
      return behavior(rules.after_hours_behavior, texts.afterHoursBehavior);
    case "out_of_scope_action":
      return behavior(rules.out_of_scope_action, texts.outOfScopeAction);
    case "lead_destination":
      return plain(integration.lead_destination);
  }
}

export type RenderScope = Readonly<{
  kind: AgentKind;
  config: AgentConfig;
  locale: PromptLocale;
  /** `contact.*`, `company.*`, … of the turn. */
  context: ContextValues;
  /** Conversation memory (`conversation.var.*`). */
  memory: Readonly<Record<string, unknown>>;
  /** Context namespaces whose values are untrusted. */
  untrustedNamespaces?: readonly string[];
}>;

const DEFAULT_UNTRUSTED = ["contact"];

/** Renders tags and variables of a text in one pass. */
export function renderTemplate(template: string, scope: RenderScope): string {
  const texts = promptTexts(scope.locale);
  const agentVars = new Map(
    (scope.config.overview.variables ?? []).map((v) => [v.key, v.value]),
  );
  const untrustedNs = new Set(scope.untrustedNamespaces ?? DEFAULT_UNTRUSTED);
  return template.replace(TAG, (match, key: string) => {
    if (TAGS.has(key)) {
      return renderConfigTag(key as ConfigTag, scope.config, texts);
    }
    if (key.startsWith("agent.var.")) {
      const value = agentVars.get(key.slice("agent.var.".length));
      return isEmpty(value) ? texts.notInformed : value!;
    }
    if (key.startsWith("conversation.var.")) {
      const value = scope.memory[key.slice("conversation.var.".length)];
      return isEmpty(value)
        ? texts.notInformed
        : untrusted(value, MAX_UNTRUSTED_INLINE);
    }
    if (!isContextVariable(scope.kind, key)) return match;
    const value = scope.context[key];
    if (isEmpty(value)) return texts.notInformed;
    if (typeof value === "boolean") return yesNo(value, texts);
    const namespace = key.slice(0, key.indexOf("."));
    return untrustedNs.has(namespace)
      ? untrusted(value, MAX_UNTRUSTED_INLINE)
      : String(value);
  });
}

const CONTACT_FIELDS = [
  "name",
  "email",
  "phone",
  "company_name",
  "job_title",
] as const;

/**
 * The data blocks after the instructions: what is known about the contact
 * and the conversation memory, marked as data that never commands.
 */
export function renderDataBlocks(scope: RenderScope): string {
  const texts = promptTexts(scope.locale);
  const lines: string[] = [];
  if (scope.kind === "guid") {
    const known = CONTACT_FIELDS.flatMap((field) => {
      const value = scope.context[`contact.${field}`];
      return isEmpty(value)
        ? []
        : [
            `- ${texts.contactFields[field] ?? field}: ${untrusted(value, MAX_UNTRUSTED_BLOCK)}`,
          ];
    });
    if (known.length > 0) lines.push(`## ${texts.contactBlock}`, ...known);
  }
  const memory = Object.entries(scope.memory)
    .filter(([, value]) => !isEmpty(value))
    .map(
      ([key, value]) => `- ${key}: ${untrusted(value, MAX_UNTRUSTED_BLOCK)}`,
    );
  if (memory.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## ${texts.memoryBlock}`, ...memory);
  }
  if (lines.length === 0) return "";
  return [texts.untrustedNotice, "", ...lines].join("\n");
}

/**
 * The system prompt of a turn: the agent's `system_prompt` rendered, then
 * the data blocks. Null when the agent has no prompt: such an agent cannot
 * be tested nor activated (campos.md §8, rule 5).
 */
export function renderSystemPrompt(scope: RenderScope): string | null {
  const template = scope.config.overview.system_prompt;
  if (!template || template.trim() === "") return null;
  const instructions = renderTemplate(template, scope);
  const data = renderDataBlocks(scope);
  return data ? `${instructions}\n\n---\n\n${data}` : instructions;
}
