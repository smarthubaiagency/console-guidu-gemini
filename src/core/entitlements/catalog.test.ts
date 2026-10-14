import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ceilingConflicts,
  CORE_QUOTA_ENTRIES,
  findQuotaEntry,
  listQuotaEntries,
  MAX_QUOTA_VALUE,
  parseQuotaInput,
  parseStoredLimits,
  quotaMessageId,
  validatePlanLimits,
} from "./catalog";
import { CORE_QUOTAS } from "./quotas";

describe("quota catalog (CF4)", () => {
  it("lists every key once: core, planned and module quotas", () => {
    const keys = listQuotaEntries().map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        "core.seats",
        "core.public_domains",
        "core.storage_gb",
        "core.upload_mb",
        "core.api_requests_per_minute",
        "core.ai_turns_per_month",
        "core.trial_days",
        "ai-agents.max",
        "crm.contacts",
        "portfolio.items",
        "portfolio.variants",
        "hello-world.records",
      ]),
    );
  });

  it("marks only the limits something enforces as enforced", () => {
    const enforced = listQuotaEntries()
      .filter((entry) => entry.status === "enforced")
      .map((entry) => entry.key);
    expect(enforced).toContain("core.public_domains");
    expect(enforced).toContain("ai-agents.max");
    expect(enforced).not.toContain("core.storage_gb");
    expect(enforced).not.toContain("core.trial_days");
    // The enforced core quotas are the ones the rest of the code knows.
    expect(CORE_QUOTAS.map((q) => q.key)).toEqual([
      "core.seats",
      "core.public_domains",
    ]);
  });

  it("takes module quotas from the manifests with their defaults", () => {
    expect(findQuotaEntry("ai-agents.max")).toMatchObject({
      owner: "ai-agents",
      defaultSource: "module",
      defaultLimit: 1,
      unit: "count",
    });
    expect(findQuotaEntry("core.public_domains")).toMatchObject({
      defaultSource: "fixed",
      defaultLimit: 0,
    });
    expect(findQuotaEntry("core.seats")).toMatchObject({
      defaultSource: "company",
      unlimitedAllowed: false,
    });
    expect(findQuotaEntry("nope.nothing")).toBeNull();
  });

  it("names the messages of the core keys like the module catalog", () => {
    expect(quotaMessageId("core.public_domains")).toBe("core_public_domains");
    expect(quotaMessageId("ai-agents.max")).toBe("ai_agents_max");
    for (const entry of CORE_QUOTA_ENTRIES) {
      expect(entry.owner).toBe("core");
      expect(entry.key.startsWith("core.")).toBe(true);
    }
  });
});

describe("plan limits against the ceilings (CF4)", () => {
  const entries = listQuotaEntries();
  const ceilings = new Map([
    ["core.public_domains", 3],
    ["crm.contacts", 1000],
  ]);

  it("accepts values within the ceiling and unlimited where there is none", () => {
    expect(
      validatePlanLimits(
        {
          "core.public_domains": 3,
          "crm.contacts": 0,
          "core.storage_gb": null,
          "ai-agents.max": null,
          "core.seats": 25,
        },
        entries,
        ceilings,
      ),
    ).toEqual([]);
  });

  it("refuses a value above the ceiling", () => {
    expect(
      validatePlanLimits({ "core.public_domains": 4 }, entries, ceilings),
    ).toEqual([
      { key: "core.public_domains", reason: "above_ceiling", ceiling: 3 },
    ]);
  });

  it("refuses unlimited under a ceiling and for seats", () => {
    expect(
      validatePlanLimits(
        { "core.public_domains": null, "core.seats": null },
        entries,
        ceilings,
      ),
    ).toEqual([
      {
        key: "core.public_domains",
        reason: "unlimited_not_allowed",
        ceiling: 3,
      },
      { key: "core.seats", reason: "unlimited_not_allowed" },
    ]);
  });

  it("refuses unknown keys and values that are not whole numbers in range", () => {
    expect(
      validatePlanLimits(
        {
          "core.nope": 1,
          "core.seats": 2.5,
          "core.trial_days": -1,
          "core.upload_mb": MAX_QUOTA_VALUE + 1,
          "crm.contacts": "10",
        },
        entries,
        ceilings,
      ).map((p) => [p.key, p.reason]),
    ).toEqual([
      ["core.nope", "unknown"],
      ["core.seats", "invalid"],
      ["core.trial_days", "invalid"],
      ["core.upload_mb", "invalid"],
      ["crm.contacts", "invalid"],
    ]);
  });
});

describe("ceiling changes (CF4)", () => {
  const plans = [
    { planName: "Essencial", limits: { "core.public_domains": 2 } },
    {
      planName: "Pro",
      limits: { "core.public_domains": 5, "crm.contacts": null },
    },
    { planName: "Base", limits: {} },
  ];

  it("lists the plans on sale a lower ceiling would leave above it", () => {
    expect(ceilingConflicts("core.public_domains", 4, plans)).toEqual([
      { planName: "Pro", value: 5 },
    ]);
    expect(ceilingConflicts("core.public_domains", 5, plans)).toEqual([]);
    expect(ceilingConflicts("core.public_domains", 1, plans)).toHaveLength(2);
  });

  it("treats an unlimited plan value as above any ceiling", () => {
    expect(ceilingConflicts("crm.contacts", 1_000_000, plans)).toEqual([
      { planName: "Pro", value: null },
    ]);
  });

  it("never conflicts when the ceiling is removed", () => {
    expect(ceilingConflicts("core.public_domains", null, plans)).toEqual([]);
  });
});

describe("stored and typed values (CF4)", () => {
  it("keeps whole numbers and nulls of a stored version, nothing else", () => {
    expect(
      parseStoredLimits({
        "core.seats": 7,
        "core.storage_gb": null,
        "core.upload_mb": 1.5,
        "crm.contacts": "9",
        "core.trial_days": -2,
      }),
    ).toEqual({ "core.seats": 7, "core.storage_gb": null });
    expect(parseStoredLimits([1, 2])).toEqual({});
    expect(parseStoredLimits(null)).toEqual({});
  });

  it("reads form input: empty is not set, digits only, within range", () => {
    expect(parseQuotaInput("")).toBeNull();
    expect(parseQuotaInput("  ")).toBeNull();
    expect(parseQuotaInput(" 12 ")).toBe(12);
    expect(parseQuotaInput("0")).toBe(0);
    expect(parseQuotaInput("1.5")).toBeUndefined();
    expect(parseQuotaInput("-1")).toBeUndefined();
    expect(parseQuotaInput("abc")).toBeUndefined();
    expect(parseQuotaInput(String(MAX_QUOTA_VALUE + 1))).toBeUndefined();
  });
});
