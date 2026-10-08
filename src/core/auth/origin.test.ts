import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAppOrigin } from "./origin";

describe("parseAppOrigin", () => {
  it("normalizes an operator-controlled HTTP(S) origin", () => {
    expect(parseAppOrigin(" https://console.guidu.co/ ")).toBe(
      "https://console.guidu.co",
    );
    expect(parseAppOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it.each([
    undefined,
    "",
    "console.guidu.co",
    "javascript:alert(1)",
    "https://user:secret@console.guidu.co",
    "https://console.guidu.co/auth",
    "https://console.guidu.co?next=evil",
    "https://console.guidu.co#fragment",
  ])("rejects a value that is not an origin: %s", (value) => {
    expect(() => parseAppOrigin(value)).toThrow();
  });
});
