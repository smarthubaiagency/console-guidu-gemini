import { describe, expect, it } from "vitest";

import { resolveSettings, type SettingRow } from "./resolve";

const row = (
  scope: SettingRow["scope"],
  key: string,
  value: unknown,
  locked = false,
): SettingRow => ({ scope, key, value, locked });

describe("resolveSettings (CF1)", () => {
  it("uses the catalog defaults with no rows", () => {
    const { values, detail } = resolveSettings([]);
    expect(values["region.currency"]).toBe("BRL");
    expect(values["region.timezone"]).toBe("America/Sao_Paulo");
    expect(detail["region.currency"]).toEqual({
      value: "BRL",
      source: "default",
      lockedBy: null,
    });
  });

  it("lets the lowest level win", () => {
    const { values, detail } = resolveSettings([
      row("platform", "region.timezone", "UTC"),
      row("partner", "region.timezone", "America/Manaus"),
      row("workspace", "region.timezone", "America/Recife"),
    ]);
    expect(values["region.timezone"]).toBe("America/Recife");
    expect(detail["region.timezone"].source).toBe("workspace");
  });

  it("stops at a lock of the platform or the partner", () => {
    const platform = resolveSettings([
      row("platform", "region.timezone", "UTC", true),
      row("partner", "region.timezone", "America/Manaus"),
      row("workspace", "region.timezone", "America/Recife"),
    ]);
    expect(platform.detail["region.timezone"]).toEqual({
      value: "UTC",
      source: "platform",
      lockedBy: "platform",
    });

    const partner = resolveSettings([
      row("partner", "region.timezone", "America/Manaus", true),
      row("workspace", "region.timezone", "America/Recife"),
    ]);
    expect(partner.values["region.timezone"]).toBe("America/Manaus");
    expect(partner.detail["region.timezone"].lockedBy).toBe("partner");
  });

  it("ignores unknown keys, values out of the schema and lower levels with `above`", () => {
    const rows = [
      row("platform", "region.unknown", "x"),
      row("partner", "region.timezone", "Mars/Olympus"),
      row("workspace", "region.timezone", "America/Recife"),
    ];
    expect(resolveSettings(rows).values["region.timezone"]).toBe(
      "America/Recife",
    );
    const inherited = resolveSettings(rows, { above: "workspace" });
    expect(inherited.detail["region.timezone"].source).toBe("default");
  });

  it("keeps the currency among the offered ones", () => {
    const offered = resolveSettings([
      row("platform", "region.currencies", ["USD", "EUR"]),
      row("partner", "region.currency", "EUR"),
      row("workspace", "region.currency", "BRL"),
    ]);
    // The workspace's BRL is no longer offered: the partner's EUR applies.
    expect(offered.values["region.currency"]).toBe("EUR");

    const none = resolveSettings([
      row("platform", "region.currencies", ["JPY"]),
    ]);
    expect(none.values["region.currency"]).toBe("JPY");
  });

  it("lets a requirement only tighten (CF5a)", () => {
    expect(resolveSettings([]).values["security.mfa.app"]).toBe(false);

    // The partner requires it: the workspace cannot turn it off.
    const partner = resolveSettings([
      row("partner", "security.mfa.app", true),
      row("workspace", "security.mfa.app", false),
    ]);
    expect(partner.detail["security.mfa.app"]).toEqual({
      value: true,
      source: "partner",
      lockedBy: "partner",
    });

    // The workspace may require it for itself, never locking anyone.
    const workspace = resolveSettings([
      row("platform", "security.mfa.app", false),
      row("workspace", "security.mfa.app", true),
    ]);
    expect(workspace.detail["security.mfa.app"]).toEqual({
      value: true,
      source: "workspace",
      lockedBy: null,
    });

    // Seen from the workspace page, the platform's requirement is a lock.
    const inherited = resolveSettings(
      [row("platform", "security.mfa.app", true)],
      { above: "workspace" },
    );
    expect(inherited.detail["security.mfa.app"].lockedBy).toBe("platform");
  });

  it("lets the partner only turn a login method off (CF5b)", () => {
    // Off by default: the partner cannot turn it on by itself.
    const none = resolveSettings([row("partner", "auth.google", true)]);
    expect(none.detail["auth.google"]).toEqual({
      value: false,
      source: "default",
      lockedBy: "platform",
    });

    // The platform offers it: on for every partner that keeps it.
    const offered = resolveSettings([row("platform", "auth.google", true)]);
    expect(offered.detail["auth.google"]).toEqual({
      value: true,
      source: "platform",
      lockedBy: null,
    });

    // A partner hides it on its hosts.
    const hidden = resolveSettings([
      row("platform", "auth.magic_link", true),
      row("partner", "auth.magic_link", false),
    ]);
    expect(hidden.detail["auth.magic_link"]).toEqual({
      value: false,
      source: "partner",
      lockedBy: null,
    });

    // The platform turns it off again: the partner's choice no longer counts.
    const withdrawn = resolveSettings([
      row("platform", "auth.magic_link", false),
      row("partner", "auth.magic_link", true),
    ]);
    expect(withdrawn.detail["auth.magic_link"]).toEqual({
      value: false,
      source: "platform",
      lockedBy: "platform",
    });

    // Seen from the partner page.
    const inherited = resolveSettings([], { above: "partner" });
    expect(inherited.detail["auth.google"].lockedBy).toBe("platform");
    // The platform itself is never stopped by the default.
    const own = resolveSettings([], { above: "platform" });
    expect(own.detail["auth.google"].lockedBy).toBeNull();
  });
});
