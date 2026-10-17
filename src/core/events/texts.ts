import type { Messages } from "@/core/i18n/locales";
import { notificationTranslator } from "@/core/notifications/templates";

import {
  EVENT_CATALOG,
  type EventDefinition,
  eventDefinition,
} from "./catalog";
import { availableChannels } from "./rules";

/**
 * Texts of the hub's own notices (H2): the WhatsApp text of each event to
 * people (editable and versioned at the platform and the partner), the
 * generic e-mail of the events without an e-mail template, the reminder,
 * the escalation and the daily digest. The defaults live in the
 * `notifications` namespace (`whatsapp.<key>`, `hub.<key>`, `digest.*`)
 * in the three languages; an edited WhatsApp text uses `{{tag}}` with the
 * tags of its event only.
 */

/** Message key of a type (`events.access_requested` → `events_access_requested`). */
export function textKeyOf(type: string): string {
  return type.replaceAll(".", "_");
}

const COMMON_TAGS = ["marca", "workspace", "link"] as const;

/** Tags each type offers to its WhatsApp text, besides the common ones. */
const TYPE_TAGS: Readonly<Record<string, readonly string[]>> = {
  "billing.subscription.past_due": ["organizacao", "vencimento"],
  "billing.subscription.suspended": ["organizacao", "vencimento"],
  "ai.agent.key_backup": ["agente", "data"],
  "ai.agent.key_paused": ["agente", "data"],
  "google_business.analyses_done": ["local"],
  "events.access_requested": ["solicitante", "motivo", "referencia", "horas"],
  "security.api_key_created": ["chave"],
  "security.api_key_revoked": ["chave"],
  "security.mfa_requirement_off": [],
  "digital_profile.lead.submitted": [],
};

export function whatsappTags(type: string): readonly string[] {
  return [...COMMON_TAGS, ...(TYPE_TAGS[type] ?? [])];
}

/** Types whose WhatsApp text may go to people (a rule may turn it on). */
export const WHATSAPP_TEXT_TYPES: readonly string[] = EVENT_CATALOG.filter(
  (definition) =>
    definition.destinations.includes("notify") &&
    !definition.inline &&
    definition.route !== "explicit" &&
    availableChannels(definition).includes("whatsapp"),
).map((definition) => definition.type);

const str = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, 200) : "";

function day(value: unknown, locale: string): string {
  const raw = str(value);
  if (!raw) return "";
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw,
  );
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** The values of an event's tags, from its data (never a secret). */
export function tagValues(
  type: string,
  data: Readonly<Record<string, unknown>>,
  brand: string,
  locale: string,
): Record<string, string> {
  const values: Record<string, string> = {
    marca: brand.slice(0, 80),
    workspace: str(data.workspaceName),
    link: /^https?:\/\//.test(str(data.linkUrl))
      ? str(data.linkUrl)
      : /^https?:\/\//.test(str(data.billingUrl))
        ? str(data.billingUrl)
        : /^https?:\/\//.test(str(data.credentialsUrl))
          ? str(data.credentialsUrl)
          : "",
  };
  switch (type) {
    case "billing.subscription.past_due":
    case "billing.subscription.suspended":
      values.organizacao = str(data.organizationName);
      values.vencimento = day(data.periodEnd, locale);
      break;
    case "ai.agent.key_backup":
    case "ai.agent.key_paused":
      values.agente = str(data.agentName);
      values.data = day(data.backupUntil, locale);
      break;
    case "google_business.analyses_done":
      values.local = str(data.location);
      break;
    case "events.access_requested":
      values.solicitante = str(data.requester);
      values.motivo = str(data.reason);
      values.referencia = str(data.reference);
      values.horas = String(Number(data.hours) || 72);
      break;
    case "security.api_key_created":
    case "security.api_key_revoked":
      values.chave = str(data.keyName) || str(data.prefix);
      break;
  }
  return values;
}

const TAG = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Tags used in a text that the type does not offer. */
export function unknownTags(type: string, body: string): string[] {
  const allowed = whatsappTags(type);
  const used = [...body.matchAll(TAG)].map((match) => match[1] ?? "");
  return [...new Set(used.filter((tag) => !allowed.includes(tag)))];
}

export const WHATSAPP_TEXT_MAX = 1000;

/** Fills the tags; a value never brings a new tag in. */
export function fillTags(
  body: string,
  values: Readonly<Record<string, string>>,
): string {
  return body
    .replace(TAG, (_, name: string) =>
      (values[name] ?? "").replace(/[{}]/g, ""),
    )
    .trim();
}

/** The default WhatsApp text of a type in a language, with its `{{tags}}`. */
export function defaultWhatsappText(
  type: string,
  locale: string,
  messages?: Messages,
): string {
  const t = notificationTranslator(locale, messages);
  const key = `whatsapp.${textKeyOf(type)}`;
  const tags = Object.fromEntries(
    whatsappTags(type).map((tag) => [tag, `{{${tag}}}`]),
  );
  try {
    const text = t(key, tags);
    return text && !text.endsWith(key) ? text : t("whatsapp.generic", tags);
  } catch {
    return t("whatsapp.generic", tags);
  }
}

/** Title and text of the generic e-mail of a type without a template. */
export function hubNoticeText(
  definition: EventDefinition,
  data: Readonly<Record<string, unknown>>,
  brand: string,
  locale: string,
  messages?: Messages,
): Readonly<{ subject: string; body: string; action: string }> {
  const t = notificationTranslator(locale, messages);
  const values = tagValues(definition.type, data, brand, locale);
  const key = `hub.${textKeyOf(definition.type)}`;
  const safe = (path: string, fallback: string) => {
    try {
      const text = t(path, values);
      return text && !text.endsWith(path) ? text : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    subject: safe(`${key}.subject`, t("hub.generic.subject", values)),
    body: safe(`${key}.body`, t("hub.generic.body", values)),
    action: t("hub.action"),
  };
}

export function isWhatsappTextType(type: string): boolean {
  return WHATSAPP_TEXT_TYPES.includes(type) && eventDefinition(type) !== null;
}
