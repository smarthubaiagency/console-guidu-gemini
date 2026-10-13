import type { AgentKind } from "../config/tools";

/**
 * Context variables of the engine, `{{namespace.key}}` (variaveis.md §2.3).
 * Only what GUIDU fills today; a new namespace enters with the module that
 * owns its data. `agent.var.*` and `conversation.var.*` are the agent's
 * constants and the conversation memory, outside this catalog.
 */

type Availability = "both" | AgentKind;

export const CONTEXT_VARIABLES = {
  contact: {
    available: "guid",
    keys: [
      "id",
      "name",
      "first_name",
      "last_name",
      "email",
      "phone",
      "company_name",
      "job_title",
    ],
  },
  company: {
    available: "both",
    keys: ["name", "timezone", "locale", "currency"],
  },
  agent: {
    available: "both",
    keys: ["id", "name", "language_default", "role"],
  },
  user: { available: "assistant", keys: ["name", "email", "timezone", "role"] },
  datetime: {
    available: "both",
    keys: ["today", "now", "timezone", "weekday", "current_time"],
  },
  conversation: {
    available: "both",
    keys: [
      "id",
      "channel",
      "started_at",
      "last_message_at",
      "language",
      "messages_count",
    ],
  },
  channel: { available: "guid", keys: ["type"] },
  tools: { available: "both", keys: ["crm.enabled", "rag.enabled"] },
} as const satisfies Record<
  string,
  { available: Availability; keys: readonly string[] }
>;

export type ContextNamespace = keyof typeof CONTEXT_VARIABLES;

export type ContextValue = string | number | boolean | null | undefined;

/** Values of the turn, by full key (`contact.first_name`). */
export type ContextValues = Readonly<Record<string, ContextValue>>;

export function isContextVariable(kind: AgentKind, key: string): boolean {
  const dot = key.indexOf(".");
  if (dot < 0) return false;
  const namespace = key.slice(0, dot) as ContextNamespace;
  const entry = CONTEXT_VARIABLES[namespace] as
    { available: Availability; keys: readonly string[] } | undefined;
  if (!entry) return false;
  if (entry.available !== "both" && entry.available !== kind) return false;
  return entry.keys.includes(key.slice(dot + 1));
}

/** "Maria da Silva" -> ["Maria", "da Silva"] (first space). */
export function splitName(name: string | null | undefined): [string, string] {
  const trimmed = (name ?? "").trim();
  const space = trimmed.indexOf(" ");
  return space < 0
    ? [trimmed, ""]
    : [trimmed.slice(0, space), trimmed.slice(space + 1).trim()];
}

export type DateTimeValues = Readonly<{
  today: string;
  now: string;
  timezone: string;
  weekday: string;
  current_time: string;
}>;

/** Date and time of the turn in the agent's time zone. */
export function dateTimeValues(
  now: Date,
  timeZone: string,
  locale: string,
): DateTimeValues {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return {
    today,
    now: `${today} ${time}`,
    timezone: timeZone,
    weekday: new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: "long",
    }).format(now),
    current_time: time,
  };
}
