import { describe, expect, it } from "vitest";

import {
  moduleContractAccess,
  planIncludesModule,
  resolveQuotaLimit,
} from "./rules";
import { type CompanyContract, LEGACY_CONTRACT } from "./types";

function subscribed(
  status: Extract<CompanyContract, { kind: "subscribed" }>["status"],
  moduleKeys: string[],
  options: { provisional?: boolean; limits?: Record<string, number> } = {},
): CompanyContract {
  return {
    kind: "subscribed",
    status,
    planName: "Plano",
    planVersion: 1,
    moduleKeys,
    limits: options.limits ?? {},
    provisional: options.provisional ?? false,
  };
}

describe("module access by contract (decision 3)", () => {
  it("keeps legacy companies as they were", () => {
    expect(moduleContractAccess(LEGACY_CONTRACT, "hello-world")).toBe("full");
  });

  it.each(["pending", "active", "past_due"] as const)(
    "allows modules in the plan while %s",
    (status) => {
      expect(
        moduleContractAccess(
          subscribed(status, ["hello-world"]),
          "hello-world",
        ),
      ).toBe("full");
      expect(
        moduleContractAccess(subscribed(status, ["catalog"]), "hello-world"),
      ).toBe("blocked");
    },
  );

  it("leaves a suspended subscription read only and blocks a canceled one", () => {
    expect(
      moduleContractAccess(
        subscribed("suspended", ["hello-world"]),
        "hello-world",
      ),
    ).toBe("read_only");
    expect(
      moduleContractAccess(
        subscribed("canceled", ["hello-world"]),
        "hello-world",
      ),
    ).toBe("blocked");
  });

  it("does not restrict modules on a provisional plan that lists none", () => {
    expect(
      planIncludesModule(subscribed("active", [], { provisional: true }), "x"),
    ).toBe(true);
    expect(
      planIncludesModule(subscribed("active", [], { provisional: false }), "x"),
    ).toBe(false);
  });
});

describe("quota limits", () => {
  it("prefers the plan, then the default, then none", () => {
    const plan = subscribed("active", [], {
      limits: { "hello-world.records": 3 },
    });
    expect(resolveQuotaLimit(plan, "hello-world.records", 10)).toBe(3);
    expect(resolveQuotaLimit(plan, "core.seats", 5)).toBe(5);
    expect(resolveQuotaLimit(LEGACY_CONTRACT, "hello-world.records", 10)).toBe(
      10,
    );
    expect(resolveQuotaLimit(LEGACY_CONTRACT, "anything", null)).toBeNull();
  });
});
