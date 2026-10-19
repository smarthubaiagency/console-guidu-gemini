import { describe, expect, it } from "vitest";

import { FACTORY_ROLES, isFactoryRole, rolesToCreate } from "./factory-roles";

describe("factory GUIDS roles (GF1)", () => {
  it("knows the four roles and nothing else", () => {
    expect(FACTORY_ROLES).toEqual([
      "orchestrator",
      "attendant",
      "seller",
      "ops",
    ]);
    expect(isFactoryRole("seller")).toBe(true);
    expect(isFactoryRole("assistant")).toBe(false);
    expect(isFactoryRole(null)).toBe(false);
  });

  it("creates every missing role without a limit", () => {
    expect(rolesToCreate(["ops", "seller"], 2, null)).toEqual([
      "seller",
      "ops",
    ]);
  });

  it("fills the limit with the front door first, ops last", () => {
    expect(rolesToCreate([...FACTORY_ROLES], 0, 2)).toEqual([
      "orchestrator",
      "attendant",
    ]);
    expect(rolesToCreate(["ops", "attendant"], 2, 3)).toEqual(["attendant"]);
  });

  it("creates nothing when the plan is already full", () => {
    expect(rolesToCreate(["ops"], 4, 4)).toEqual([]);
    expect(rolesToCreate(["ops"], 6, 4)).toEqual([]);
  });
});
