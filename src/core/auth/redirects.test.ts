import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, safeInternalPath } from "./redirects";

describe("safeInternalPath", () => {
  it("keeps an internal path", () => {
    expect(safeInternalPath("/app/account/security")).toBe(
      "/app/account/security",
    );
  });

  it("keeps the query string of an internal path", () => {
    expect(safeInternalPath("/app?tab=security")).toBe("/app?tab=security");
  });

  it.each([
    "https://evil.example/app",
    "//evil.example",
    "/\\evil.example",
    "/app\\..\\admin",
    "app",
    "",
    null,
    undefined,
  ])("falls back for %s", (candidate) => {
    expect(safeInternalPath(candidate)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("honours an explicit fallback", () => {
    expect(safeInternalPath("https://evil.example", "/login")).toBe("/login");
  });
});
