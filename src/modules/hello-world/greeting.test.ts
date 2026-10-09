import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { pickGreeting } from "./server/services/greeting";

describe("hello-world greeting inheritance", () => {
  it("uses the workspace override first", () => {
    expect(
      pickGreeting({ greeting: "Olá, Acme!" }, { defaultGreeting: "Oi" }),
    ).toEqual({
      greeting: "Olá, Acme!",
      origin: "workspace",
    });
  });

  it("falls back to the global default, then to the module fallback", () => {
    expect(pickGreeting({}, { defaultGreeting: "Oi" })).toEqual({
      greeting: "Oi",
      origin: "global",
    });
    expect(pickGreeting({}, {})).toEqual({
      greeting: "Hello, World!",
      origin: "fallback",
    });
  });

  it("ignores invalid stored values", () => {
    expect(pickGreeting({ greeting: "" }, { defaultGreeting: 42 })).toEqual({
      greeting: "Hello, World!",
      origin: "fallback",
    });
  });
});
