import { describe, expect, it } from "vitest";

import { resolveSettings, type SettingRow } from "@/core/settings/resolve";

import { eventDefinition } from "./catalog";
import { notificationSettingsOf } from "./rule-settings";
import {
  bypassesQuietHours,
  checkRuleForLevel,
  defaultRule,
  DEFAULT_QUIET_HOURS,
  effectiveRule,
  inQuietHours,
  mergeRules,
  nextDigestAt,
  presetOf,
  quietWindowEnd,
  RuleError,
  RulesSchema,
} from "./rules";
import {
  defaultWhatsappText,
  fillTags,
  tagValues,
  unknownTags,
  WHATSAPP_TEXT_TYPES,
} from "./texts";

const def = (type: string) => {
  const definition = eventDefinition(type);
  if (!definition) throw new Error(type);
  return definition;
};

const row = (
  scope: SettingRow["scope"],
  key: string,
  value: unknown,
  locked = false,
): SettingRow => ({ scope, key, value, locked });

describe("notice rules in the cascade (H2)", () => {
  it("keeps the H1 behaviour with no rule anywhere", () => {
    const key = def("ai.agent.key_backup");
    expect(defaultRule(key).enabled).toBe(true);
    expect(effectiveRule(key, {})).toMatchObject({
      enabled: true,
      channels: ["app", "email"],
      recipients: "route",
      delivery: "immediate",
      escalateAfterHours: null,
    });
    // Security events are recorded but their notice starts off.
    expect(effectiveRule(def("security.api_key_created"), {}).enabled).toBe(false);
  });

  it("merges the levels type by type and honours a lock above", () => {
    const rows = [
      row("platform", "notifications.rules", {
        "google_business.analyses_done": { delivery: "digest", locked: true },
        "security.api_key_created": { enabled: true, channels: ["email"] },
      }),
      row("partner", "notifications.rules", {
        "google_business.analyses_done": { delivery: "immediate" },
        "security.api_key_created": { channels: ["app", "whatsapp"] },
      }),
      row("workspace", "notifications.rules", {
        "security.api_key_created": { recipients: ["owner"] },
      }),
    ];
    const { rules } = notificationSettingsOf(rows);
    expect(effectiveRule(def("google_business.analyses_done"), rules).delivery).toBe(
      "digest",
    );
    expect(effectiveRule(def("security.api_key_created"), rules)).toMatchObject({
      enabled: true,
      channels: ["app", "whatsapp"],
      recipients: ["owner"],
    });
    // Seen from the workspace (inheritance) the partner's choice applies.
    const above = resolveSettings(rows, { above: "workspace" }).values[
      "notifications.rules"
    ];
    expect(effectiveRule(def("security.api_key_created"), above).recipients).toBe(
      "route",
    );
  });

  it("never turns an essential event off and keeps its channels", () => {
    const backup = def("ai.agent.key_backup");
    const rule = effectiveRule(backup, {
      "ai.agent.key_backup": { enabled: false, channels: ["whatsapp"] },
    });
    expect(rule.enabled).toBe(true);
    expect(rule.channels).toEqual(["app", "email", "whatsapp"]);
    expect(() => checkRuleForLevel(backup, { enabled: false }, "platform")).toThrow(
      RuleError,
    );
  });

  it("refuses what a level or a type does not accept", () => {
    expect(() =>
      checkRuleForLevel(def("platform.events.chain_broken"), {}, "partner"),
    ).toThrow(/level/);
    expect(() =>
      checkRuleForLevel(def("security.api_key_created"), { locked: true }, "workspace"),
    ).toThrow(/lock/);
    expect(() =>
      checkRuleForLevel(
        def("billing.subscription.past_due"),
        { recipients: ["owner"] },
        "platform",
      ),
    ).toThrow(/role/);
    expect(() =>
      checkRuleForLevel(
        def("ai.agent.lead_hot"),
        { channels: ["email"] },
        "platform",
      ),
    ).toThrow(/channel/);
    expect(() =>
      checkRuleForLevel(
        def("security.api_key_created"),
        { escalate_after_hours: 4 },
        "platform",
      ),
    ).toThrow(/escalation/);
    expect(RulesSchema.safeParse({ "nao.existe": {} }).success).toBe(false);
    // Explicit and platform routes ignore roles.
    expect(
      effectiveRule(def("platform.events.chain_broken"), {
        "platform.events.chain_broken": { recipients: ["owner"] },
      }).recipients,
    ).toBe("route");
  });

  it("escalates only approvals", () => {
    const access = def("events.access_requested");
    expect(
      effectiveRule(access, {
        "events.access_requested": { escalate_after_hours: 6, escalate_to: ["owner"] },
      }),
    ).toMatchObject({ escalateAfterHours: 6, escalateTo: ["owner"] });
    expect(mergeRules({ a: { locked: true, enabled: false } }, { a: { enabled: true } }))
      .toEqual({ a: { locked: true, enabled: false } });
    expect(presetOf(["admin", "owner"])).toBe("owner_admin");
    expect(presetOf(["viewer"])).toBe("custom");
  });
});

describe("quiet window and digest in the workspace's time zone (H2)", () => {
  const SP = "America/Sao_Paulo";

  it("holds from 20h to 8h and on Sundays", () => {
    // Wednesday 2026-10-14 21:00 in São Paulo = 2026-10-15T00:00Z.
    const night = new Date("2026-10-15T00:00:00Z");
    expect(inQuietHours(night, DEFAULT_QUIET_HOURS, SP)).toBe(true);
    expect(quietWindowEnd(night, DEFAULT_QUIET_HOURS, SP).toISOString()).toBe(
      "2026-10-15T11:00:00.000Z",
    );
    // Wednesday 10:00 in São Paulo.
    const day = new Date("2026-10-14T13:00:00Z");
    expect(inQuietHours(day, DEFAULT_QUIET_HOURS, SP)).toBe(false);
    expect(quietWindowEnd(day, DEFAULT_QUIET_HOURS, SP)).toEqual(day);
    // Saturday 22:00 → Monday 08:00 (Sunday is quiet all day).
    const saturday = new Date("2026-10-18T01:00:00Z");
    expect(quietWindowEnd(saturday, DEFAULT_QUIET_HOURS, SP).toISOString()).toBe(
      "2026-10-19T11:00:00.000Z",
    );
    // The same instant is daytime in Tokyo.
    expect(inQuietHours(night, DEFAULT_QUIET_HOURS, "Asia/Tokyo")).toBe(false);
    expect(inQuietHours(night, { ...DEFAULT_QUIET_HOURS, enabled: false }, SP)).toBe(
      false,
    );
  });

  it("puts an event in the next digest at the configured time", () => {
    expect(
      nextDigestAt(new Date("2026-10-14T10:59:00Z"), "08:00", SP).toISOString(),
    ).toBe("2026-10-14T11:00:00.000Z");
    expect(
      nextDigestAt(new Date("2026-10-14T11:05:00Z"), "08:00", SP).toISOString(),
    ).toBe("2026-10-15T11:00:00.000Z");
    // Lisbon in summer time (UTC+1).
    expect(
      nextDigestAt(new Date("2026-07-01T06:00:00Z"), "08:00", "Europe/Lisbon").toISOString(),
    ).toBe("2026-07-01T07:00:00.000Z");
  });

  it("lets an urgent security event through", () => {
    expect(bypassesQuietHours(def("security.mfa_requirement_off"))).toBe(true);
    expect(bypassesQuietHours(def("security.api_key_created"))).toBe(false);
    expect(bypassesQuietHours(def("ai.agent.key_paused"))).toBe(false);
  });
});

describe("WhatsApp texts (H2)", () => {
  it("has a default text with tags for each type, in the three languages", () => {
    for (const type of WHATSAPP_TEXT_TYPES) {
      for (const locale of ["pt-BR", "en", "es"]) {
        const text = defaultWhatsappText(type, locale);
        expect(text, `${type} ${locale}`).toContain("{{marca}}");
        expect(unknownTags(type, text), `${type} ${locale}`).toEqual([]);
      }
    }
  });

  it("validates and fills the tags of the event only", () => {
    expect(unknownTags("security.api_key_created", "{{chave}} {{senha}}")).toEqual([
      "senha",
    ]);
    const values = tagValues(
      "events.access_requested",
      { requester: "GUIDU", reason: "Chamado", reference: "R-1", hours: 48 },
      "Marca",
      "pt-BR",
    );
    expect(
      fillTags("{{marca}}: {{solicitante}} {{horas}}h {{ desconhecida }}", values),
    ).toBe("Marca: GUIDU 48h");
    // A value never brings a tag in.
    expect(fillTags("{{workspace}}", { workspace: "{{marca}}" })).toBe("marca");
  });
});
