import { describe, expect, it } from "vitest";

import { WORKSPACE_SCOPES } from "@/core/mcp/scopes";

import {
  allowedScopes,
  configuredRateLimits,
  effectiveRateLimits,
  environmentRateDefault,
  RATE_LIMIT_QUOTAS,
  rateLimitValues,
  usableScopes,
} from "./limits";

describe("API limits and scopes per plan (CF6b)", () => {
  const defaults = { key: 60, user: 120, workspace: 300 };

  it("takes the plan's value, else the environment's, capped by the ceiling", () => {
    const limits = effectiveRateLimits({
      planLimits: {
        [RATE_LIMIT_QUOTAS.key]: 10,
        [RATE_LIMIT_QUOTAS.workspace]: 900,
        [RATE_LIMIT_QUOTAS.user]: null,
      },
      ceilings: new Map([[RATE_LIMIT_QUOTAS.workspace, 500]]),
      defaults,
    });
    expect(limits.key).toEqual({ value: 10, source: "plan", ceiling: null });
    // "Sem limite" left over in a plan counts as the default.
    expect(limits.user).toEqual({
      value: 120,
      source: "default",
      ceiling: null,
    });
    expect(limits.workspace).toEqual({
      value: 500,
      source: "plan",
      ceiling: 500,
    });
    expect(rateLimitValues(limits)).toEqual({
      key: 10,
      user: 120,
      workspace: 500,
    });
  });

  it("caps the environment's default too, and works without a plan", () => {
    const limits = effectiveRateLimits({
      planLimits: null,
      ceilings: new Map([[RATE_LIMIT_QUOTAS.key, 30]]),
      defaults,
    });
    expect(rateLimitValues(limits)).toEqual({
      key: 30,
      user: 120,
      workspace: 300,
    });
  });

  it("reads the environment only as the default", () => {
    expect(
      configuredRateLimits({ API_RATE_LIMIT_PER_WORKSPACE: "50" }),
    ).toEqual({ key: 60, user: 120, workspace: 50 });
    expect(
      environmentRateDefault(RATE_LIMIT_QUOTAS.user, {
        API_RATE_LIMIT_PER_USER: "7",
      }),
    ).toBe(7);
    expect(environmentRateDefault("core.seats", {})).toBeNull();
  });

  it("allows every scope without a plan or a list, else only the list", () => {
    expect(allowedScopes({}, null)).toEqual([...WORKSPACE_SCOPES]);
    expect(allowedScopes({ pro: ["crm:read"] }, "essencial")).toEqual([
      ...WORKSPACE_SCOPES,
    ]);
    expect(
      allowedScopes({ essencial: ["crm:read", "workspace:read"] }, "essencial"),
    ).toEqual(["workspace:read", "crm:read"]);
    expect(allowedScopes({ essencial: [] }, "essencial")).toEqual([]);
  });

  it("drops from a key the scopes its plan no longer allows", () => {
    expect(
      usableScopes(["workspace:read", "crm:write"], ["workspace:read"]),
    ).toEqual(["workspace:read"]);
  });
});
