import { describe, expect, it } from "vitest";

import { CONTEXT_TABS, isContextTab, isInboxView } from "./views";

describe("Inbox address bar values (IN4c)", () => {
  it("accepts the tabs of the context panel and nothing else", () => {
    expect(CONTEXT_TABS).toEqual(["contact", "threads"]);
    expect(isContextTab("contact")).toBe(true);
    expect(isContextTab("threads")).toBe(true);
    expect(isContextTab("notes")).toBe(false);
    expect(isContextTab(undefined)).toBe(false);
    expect(isContextTab(["threads"])).toBe(false);
  });

  it("keeps the four views of the type selector", () => {
    for (const view of ["mine", "unassigned", "all", "resolved"]) {
      expect(isInboxView(view)).toBe(true);
    }
    expect(isInboxView("threads")).toBe(false);
  });
});
