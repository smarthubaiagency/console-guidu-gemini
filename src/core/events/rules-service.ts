import "server-only";

import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  saveSettings,
  type SettingsActor,
  settingsView,
  type SettingsView,
} from "@/core/settings/service";

import {
  EVENT_CATALOG,
  type EventDefinition,
  eventDefinition,
} from "./catalog";
import {
  checkRuleForLevel,
  type EffectiveRule,
  effectiveRule,
  type QuietHours,
  QuietHoursSchema,
  type Rule,
  RuleError,
  type Rules,
  RULE_EVENT_TYPES,
  ruleEditableAt,
} from "./rules";

/**
 * Configurações › Notificações at the three levels (H2): the rules per
 * event type, the quiet window and the digest time, written through the
 * settings cascade (ADR 0018). A level stores only what differs from what
 * it inherits; a type the level above locked is read-only.
 */

export type RuleLine = Readonly<{
  definition: EventDefinition;
  /** What the level gets with nothing of its own. */
  inherited: EffectiveRule;
  /** What applies now. */
  effective: EffectiveRule;
  /** The level has a rule of its own for the type. */
  own: boolean;
  /** Locked by a level above (the type or the whole key). */
  lockedAbove: boolean;
}>;

export type NotificationSettingsView = Readonly<{
  view: SettingsView;
  lines: RuleLine[];
  quiet: QuietHours;
  quietOwn: boolean;
  quietLockedAbove: boolean;
  quietLocked: boolean;
  digestTime: string;
  digestOwn: boolean;
  digestLockedAbove: boolean;
  digestLocked: boolean;
}>;

export async function notificationSettingsView(
  tx: ContextTransaction,
  actor: SettingsActor,
): Promise<NotificationSettingsView> {
  const view = await settingsView(tx, actor);
  const inheritedRules = view.inherited.values["notifications.rules"] as Rules;
  const effectiveRules = view.effective.values["notifications.rules"] as Rules;
  const ownRules = (view.own["notifications.rules"]?.value ?? {}) as Rules;
  const keyLocked = Boolean(
    view.inherited.detail["notifications.rules"].lockedBy,
  );
  const lines = EVENT_CATALOG.filter(
    (definition) =>
      RULE_EVENT_TYPES.includes(definition.type) &&
      ruleEditableAt(definition, view.level),
  ).map((definition) => ({
    definition,
    inherited: effectiveRule(definition, inheritedRules),
    effective: effectiveRule(definition, effectiveRules),
    own: Boolean(ownRules[definition.type]),
    lockedAbove: keyLocked || inheritedRules[definition.type]?.locked === true,
  }));
  return {
    view,
    lines,
    quiet: view.effective.values["notifications.quiet_hours"] as QuietHours,
    quietOwn: Boolean(view.own["notifications.quiet_hours"]),
    quietLockedAbove: Boolean(
      view.inherited.detail["notifications.quiet_hours"].lockedBy,
    ),
    quietLocked: view.own["notifications.quiet_hours"]?.locked === true,
    digestTime: view.effective.values["notifications.digest_time"] as string,
    digestOwn: Boolean(view.own["notifications.digest_time"]),
    digestLockedAbove: Boolean(
      view.inherited.detail["notifications.digest_time"].lockedBy,
    ),
    digestLocked: view.own["notifications.digest_time"]?.locked === true,
  };
}

function ruleError(error: RuleError): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: "Regra de aviso inválida.",
    messageKey: `eventRules.errors.rule.${error.key}`,
  });
}

const same = (a: EffectiveRule, b: EffectiveRule) =>
  JSON.stringify({ ...a, locked: false }) ===
  JSON.stringify({ ...b, locked: false });

/**
 * Saves the rules of the types in the form. A rule equal to what the level
 * inherits (and not locked) is not stored; locked types above are skipped.
 */
export async function saveNotificationRules(
  tx: ContextTransaction,
  actor: SettingsActor,
  submitted: Readonly<Record<string, Rule>>,
): Promise<void> {
  const current = await notificationSettingsView(tx, actor);
  const ownRules = {
    ...((current.view.own["notifications.rules"]?.value ?? {}) as Rules),
  };
  for (const [type, raw] of Object.entries(submitted)) {
    const definition = eventDefinition(type);
    const line = current.lines.find((l) => l.definition.type === type);
    if (!definition || !line) {
      throw ruleError(new RuleError("level"));
    }
    if (line.lockedAbove) continue;
    let rule: Rule;
    try {
      rule = checkRuleForLevel(
        definition,
        definition.essential ? { ...raw, enabled: true } : raw,
        actor.level,
      );
    } catch (error) {
      if (error instanceof RuleError) throw ruleError(error);
      throw error;
    }
    const candidate = effectiveRule(definition, { [type]: rule });
    if (same(candidate, line.inherited) && !rule.locked) {
      delete ownRules[type];
    } else {
      ownRules[type] = rule;
    }
  }
  await saveSettings(tx, actor, {
    values: {
      "notifications.rules": Object.keys(ownRules).length > 0 ? ownRules : null,
    },
  });
}

/** Saves the quiet window (null inherits) and its lock. */
export async function saveQuietHours(
  tx: ContextTransaction,
  actor: SettingsActor,
  value: QuietHours | null,
  locked: boolean,
): Promise<void> {
  if (value && !QuietHoursSchema.safeParse(value).success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Janela de silêncio inválida.",
      messageKey: "eventRules.errors.quiet",
    });
  }
  await saveSettings(tx, actor, {
    values: { "notifications.quiet_hours": value },
    locks: { "notifications.quiet_hours": locked },
  });
}

/** Saves the digest time (null inherits) and its lock. */
export async function saveDigestTime(
  tx: ContextTransaction,
  actor: SettingsActor,
  value: string | null,
  locked: boolean,
): Promise<void> {
  await saveSettings(tx, actor, {
    values: { "notifications.digest_time": value },
    locks: { "notifications.digest_time": locked },
  });
}
