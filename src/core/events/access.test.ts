import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ACCESS_MAX_EVENTS, commonTarget } from "./access";

const A = { workspaceId: "w-a", organizationId: "o-a" };
const B = { workspaceId: "w-b", organizationId: "o-b" };

describe("access to several events at once (AJ1)", () => {
  it("covers the events of one workspace", () => {
    expect(commonTarget([A, { ...A }, { ...A }])).toEqual(A);
  });

  it("refuses events of more than one workspace", () => {
    expect(commonTarget([A, B])).toBe("mixed");
    expect(
      commonTarget([A, { workspaceId: "w-a", organizationId: "o-b" }]),
    ).toBe("mixed");
  });

  it("answers null for an unknown event or none", () => {
    expect(commonTarget([A, null])).toBeNull();
    expect(commonTarget([])).toBeNull();
  });

  it("keeps the table's limit of events per request", () => {
    expect(ACCESS_MAX_EVENTS).toBe(50);
  });
});
