import { z } from "zod";

import {
  EVENT_CATALOG,
  EVENT_CHANNELS,
  type EventChannel,
  type EventDefinition,
  type EventLevel,
  eventDefinition,
} from "./catalog";

/**
 * Notice rules of the Event Hub (H2, ADR 0018 and 0022): per event type,
 * whether it is on, the channels, who hears it, immediate or in the daily
 * digest, and the escalation of an approval nobody answers. They live in
 * the settings cascade (`notifications.rules`): the platform sets the
 * default and may lock a type, the partner adjusts it for its customers
 * (and may lock), the workspace adjusts what was left open. With no rule
 * anywhere every type behaves as in H1: on (except the security events,
 * off by default), the catalog's channels, the route of the catalog and
 * immediate.
 *
 * Also the quiet window (WhatsApp only, the workspace's time zone) and the
 * time of the digest. Pure and dependency-free besides zod: the settings
 * catalog, the worker and the screens share it.
 */

export const RULE_WORKSPACE_ROLES = [
  "owner",
  "admin",
  "editor",
  "viewer",
] as const;
export const RULE_PARTNER_ROLES = [
  "partner_owner",
  "partner_admin",
  "partner_support",
] as const;
export const RULE_ROLES = [...RULE_WORKSPACE_ROLES, ...RULE_PARTNER_ROLES];
export type RuleRole = (typeof RULE_ROLES)[number];

export const RULE_DELIVERIES = ["immediate", "digest"] as const;
export type RuleDelivery = (typeof RULE_DELIVERIES)[number];

/** Types the rules govern: the ones with the `notify` destination. */
export const RULE_EVENT_TYPES = EVENT_CATALOG.filter(
  (definition) =>
    definition.destinations.includes("notify") && !definition.inline,
).map((definition) => definition.type);

const roleList = z
  .array(z.enum(RULE_ROLES as [RuleRole, ...RuleRole[]]))
  .max(RULE_ROLES.length)
  .refine((roles) => new Set(roles).size === roles.length, "duplicated role");

export const RuleSchema = z.strictObject({
  enabled: z.boolean().optional(),
  channels: z
    .array(z.enum(EVENT_CHANNELS))
    .max(EVENT_CHANNELS.length)
    .refine((list) => new Set(list).size === list.length, "duplicated channel")
    .optional(),
  /** "route" follows the catalog's route (the service mode). */
  recipients: z.union([z.literal("route"), roleList.min(1)]).optional(),
  delivery: z.enum(RULE_DELIVERIES).optional(),
  escalate_after_hours: z.number().int().min(1).max(720).nullable().optional(),
  escalate_to: roleList.optional(),
  /** Platform and partner only: the levels below keep this type as it is. */
  locked: z.boolean().optional(),
});
export type Rule = z.infer<typeof RuleSchema>;

export type Rules = Partial<Record<string, Rule>>;

export const RulesSchema: z.ZodType<Rules> = z
  .record(z.string().max(80), RuleSchema)
  .refine(
    (value) =>
      Object.keys(value).every((type) =>
        (RULE_EVENT_TYPES as readonly string[]).includes(type),
      ),
    "unknown event type",
  ) as z.ZodType<Rules>;

/**
 * The value of a level below the first, combined with the one above (the
 * cascade's `narrow`): type by type, the level below overrides what it
 * sets, except a type the level above locked.
 */
export function mergeRules(above: Rules, below: Rules): Rules {
  const merged: Rules = { ...above };
  for (const [type, rule] of Object.entries(below)) {
    if (!rule) continue;
    if (above[type]?.locked) continue;
    merged[type] = { ...above[type], ...rule };
  }
  return merged;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const QuietHoursSchema = z.strictObject({
  enabled: z.boolean(),
  start: time,
  end: time,
  sundays: z.boolean(),
});
export type QuietHours = z.infer<typeof QuietHoursSchema>;

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: true,
  start: "20:00",
  end: "08:00",
  sundays: true,
};

export const DigestTimeSchema = time;
export const DEFAULT_DIGEST_TIME = "08:00";

export type EffectiveRule = Readonly<{
  type: string;
  enabled: boolean;
  channels: readonly EventChannel[];
  recipients: "route" | readonly RuleRole[];
  delivery: RuleDelivery;
  escalateAfterHours: number | null;
  escalateTo: readonly RuleRole[];
  locked: boolean;
}>;

/** Channels a rule may give a type. */
export function availableChannels(
  definition: EventDefinition,
): readonly EventChannel[] {
  // An explicit target (the agent's `owner_phone`) has only its channels.
  if (definition.route === "explicit") return definition.channels;
  // The platform's own notices stay in the bell and e-mail.
  if (definition.level === "platform") {
    return EVENT_CHANNELS.filter((channel) => channel !== "whatsapp");
  }
  return EVENT_CHANNELS;
}

/** Roles a rule may name for a type, by its level. */
export function availableRoles(definition: EventDefinition): readonly RuleRole[] {
  if (definition.route === "explicit" || definition.level === "platform") {
    return [];
  }
  if (definition.level === "partner") return RULE_PARTNER_ROLES;
  return RULE_ROLES;
}

/** Levels where a type's rule may be set. */
export function ruleLevels(definition: EventDefinition): readonly EventLevel[] {
  switch (definition.level) {
    case "platform":
      return ["platform"];
    case "partner":
      return ["platform", "partner"];
    case "workspace":
      return ["platform", "partner", "workspace"];
  }
}

export function ruleEditableAt(
  definition: EventDefinition,
  level: EventLevel,
): boolean {
  return ruleLevels(definition).includes(level);
}

/** The rule with no setting anywhere: the H1 behaviour. */
export function defaultRule(definition: EventDefinition): EffectiveRule {
  return {
    type: definition.type,
    enabled: definition.notifyByDefault !== false,
    channels: definition.channels,
    recipients: "route",
    delivery: "immediate",
    escalateAfterHours: null,
    escalateTo: [],
    locked: false,
  };
}

/** The rule that applies to a type, from the resolved rules of the cascade. */
export function effectiveRule(
  definition: EventDefinition,
  rules: Rules,
): EffectiveRule {
  const base = defaultRule(definition);
  const rule = rules[definition.type] ?? {};
  const allowed = availableChannels(definition);
  const roles = availableRoles(definition);
  let channels = (rule.channels ?? base.channels).filter((channel) =>
    allowed.includes(channel),
  );
  // An essential event never loses the catalog's channels.
  if (definition.essential) {
    channels = [...new Set([...definition.channels, ...channels])];
  }
  const named =
    rule.recipients && rule.recipients !== "route"
      ? rule.recipients.filter((role) => roles.includes(role))
      : [];
  return {
    type: definition.type,
    enabled: definition.essential ? true : (rule.enabled ?? base.enabled),
    channels: EVENT_CHANNELS.filter((channel) => channels.includes(channel)),
    recipients: named.length > 0 ? named : "route",
    delivery: rule.delivery ?? base.delivery,
    escalateAfterHours: definition.approval
      ? (rule.escalate_after_hours ?? null)
      : null,
    escalateTo: (rule.escalate_to ?? []).filter((role) => roles.includes(role)),
    locked: rule.locked === true,
  };
}

export function effectiveRuleOf(type: string, rules: Rules): EffectiveRule | null {
  const definition = eventDefinition(type);
  return definition ? effectiveRule(definition, rules) : null;
}

/**
 * What a level may save for one type: refuses an essential type turned off
 * and a lock below the partner; keeps only the channels and roles the type
 * accepts. Throws a message key of `eventRules.errors`.
 */
export function checkRuleForLevel(
  definition: EventDefinition,
  rule: Rule,
  level: EventLevel,
): Rule {
  if (!ruleEditableAt(definition, level)) throw new RuleError("level");
  if (definition.essential && rule.enabled === false) {
    throw new RuleError("essential");
  }
  if (rule.locked && level === "workspace") throw new RuleError("lock");
  const allowed = availableChannels(definition);
  if (rule.channels?.some((channel) => !allowed.includes(channel))) {
    throw new RuleError("channel");
  }
  const roles = availableRoles(definition);
  const named = [
    ...(rule.recipients && rule.recipients !== "route" ? rule.recipients : []),
    ...(rule.escalate_to ?? []),
  ];
  if (named.some((role) => !roles.includes(role))) throw new RuleError("role");
  if (!definition.approval && rule.escalate_after_hours) {
    throw new RuleError("escalation");
  }
  return rule;
}

export class RuleError extends Error {
  constructor(readonly key: string) {
    super(`notifications.rules: ${key}`);
    this.name = "RuleError";
  }
}

/** Recipient presets of the screens; a saved list outside them is "custom". */
export const RECIPIENT_PRESETS: Readonly<
  Record<string, "route" | readonly RuleRole[]>
> = {
  route: "route",
  owner_admin: ["owner", "admin"],
  owner: ["owner"],
  members: ["owner", "admin", "editor", "viewer"],
  partner_team: ["partner_owner", "partner_admin", "partner_support"],
  partner_owner: ["partner_owner"],
  owner_admin_partner_team: [
    "owner",
    "admin",
    "partner_owner",
    "partner_admin",
    "partner_support",
  ],
};

export function presetOf(value: "route" | readonly RuleRole[]): string {
  if (value === "route") return "route";
  const sorted = [...value].sort().join(",");
  for (const [key, preset] of Object.entries(RECIPIENT_PRESETS)) {
    if (preset !== "route" && [...preset].sort().join(",") === sorted) {
      return key;
    }
  }
  return "custom";
}

/** Presets that only name roles the type accepts. */
export function presetsFor(definition: EventDefinition): string[] {
  const roles = availableRoles(definition);
  return Object.entries(RECIPIENT_PRESETS)
    .filter(
      ([, preset]) =>
        preset === "route" ||
        (roles.length > 0 && preset.every((role) => roles.includes(role))),
    )
    .map(([key]) => key);
}

// ---------------------------------------------------------------------------
// Time: the quiet window and the digest, in the workspace's time zone
// ---------------------------------------------------------------------------

type LocalParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
}>;

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        weekday: "short",
      });
    } catch {
      formatter = formatterOf("America/Sao_Paulo");
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatterOf(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? "Sun"] ?? 0,
  };
}

/** The instant of a wall-clock time in a time zone (DST-aware). */
export function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const local = localParts(new Date(guess), timeZone);
    const seen = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    );
    const diff = wanted - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

const minutesOf = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function inQuietHours(
  now: Date,
  quiet: QuietHours,
  timeZone: string,
): boolean {
  if (!quiet.enabled) return false;
  const local = localParts(now, timeZone);
  if (quiet.sundays && local.weekday === 0) return true;
  const at = local.hour * 60 + local.minute;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? at >= start && at < end : at >= start || at < end;
}

/**
 * The next instant after `now` at the wall-clock `hm` in the time zone
 * (today when still ahead, else the next day).
 */
export function nextLocalTime(now: Date, hm: string, timeZone: string): Date {
  const local = localParts(now, timeZone);
  const [h, m] = hm.split(":").map(Number);
  for (let offset = 0; offset < 3; offset += 1) {
    const day = new Date(
      Date.UTC(local.year, local.month - 1, local.day + offset),
    );
    const candidate = zonedInstant(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      h ?? 0,
      m ?? 0,
      timeZone,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return new Date(now.getTime() + 86_400_000);
}

/** When a WhatsApp held by the quiet window may leave. */
export function quietWindowEnd(
  now: Date,
  quiet: QuietHours,
  timeZone: string,
): Date {
  if (!inQuietHours(now, quiet, timeZone)) return now;
  let candidate = nextLocalTime(now, quiet.end, timeZone);
  // A Sunday is quiet all day: the window ends on Monday at `end`.
  for (let i = 0; i < 8 && inQuietHours(candidate, quiet, timeZone); i += 1) {
    candidate = nextLocalTime(candidate, quiet.end, timeZone);
  }
  return candidate;
}

/** The digest that takes an event recorded at `now`. */
export function nextDigestAt(now: Date, hm: string, timeZone: string): Date {
  return nextLocalTime(now, hm, timeZone);
}

/** An urgent security event goes through the quiet window. */
export function bypassesQuietHours(definition: EventDefinition): boolean {
  return definition.module === "security" && definition.severity === "urgent";
}
