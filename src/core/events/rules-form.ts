import { EVENT_CHANNELS, eventDefinition } from "./catalog";
import {
  RECIPIENT_PRESETS,
  type Rule,
  RULE_DELIVERIES,
  RULE_EVENT_TYPES,
} from "./rules";

/*
 * Reads the notification rules form (H2). Kept out of the "use server"
 * actions file so it is never exposed as a Server Action: it only parses
 * the form; the action that calls it checks who is asking.
 */

/** The rules of the form: `rule:<type>:<field>` for each type in `rules:types`. */
export function readRulesForm(formData: FormData): Record<string, Rule> {
  const types = String(formData.get("rules:types") ?? "")
    .split(",")
    .filter((type) => (RULE_EVENT_TYPES as readonly string[]).includes(type));
  const rules: Record<string, Rule> = {};
  for (const type of types) {
    const definition = eventDefinition(type);
    if (!definition) continue;
    const field = (name: string) => formData.get(`rule:${type}:${name}`);
    const preset = String(field("recipients") ?? "route");
    const escalatePreset = String(field("escalate_to") ?? "");
    const hoursRaw = String(field("escalate_after_hours") ?? "").trim();
    const delivery = String(field("delivery") ?? "immediate");
    const recipients = RECIPIENT_PRESETS[preset];
    const escalateTo = RECIPIENT_PRESETS[escalatePreset];
    const rule: Rule = {
      enabled: field("enabled") === "on",
      channels: EVENT_CHANNELS.filter(
        (channel) => field(`channel:${channel}`) === "on",
      ),
      recipients:
        recipients && recipients !== "route" ? [...recipients] : "route",
      delivery: (RULE_DELIVERIES as readonly string[]).includes(delivery)
        ? (delivery as Rule["delivery"])
        : "immediate",
      ...(definition.approval
        ? {
            escalate_after_hours: hoursRaw
              ? Number.parseInt(hoursRaw, 10) || null
              : null,
            escalate_to:
              escalateTo && escalateTo !== "route" ? [...escalateTo] : [],
          }
        : {}),
      ...(field("locked") === "on" ? { locked: true } : {}),
    };
    rules[type] = rule;
  }
  return rules;
}
