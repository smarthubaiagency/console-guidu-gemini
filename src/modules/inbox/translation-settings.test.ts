import { describe, expect, it } from "vitest";

import {
  enginesInUse,
  suggestFastModel,
  translationSettingsOf,
} from "./translation-settings";

describe("translation settings (TR2)", () => {
  it("suggests a fast and cheap model", () => {
    expect(
      suggestFastModel("openai", ["gpt-5-mini", "gpt-5", "gpt-5-nano"]),
    ).toBe("gpt-5-nano");
    expect(
      suggestFastModel("anthropic", ["claude-sonnet-5-5", "claude-haiku-5-5"]),
    ).toBe("claude-haiku-5-5");
    expect(suggestFastModel("gemini", null)).toBe("gemini-2.5-flash-lite");
    expect(suggestFastModel("openrouter", ["x/big"])).toBe("x/big");
  });

  it("reads the block tolerantly and lists the engines in use", () => {
    expect(translationSettingsOf({ translation: { enabled: "yes" } })).toEqual(
      translationSettingsOf({}),
    );
    const settings = translationSettingsOf({
      translation: { enabled: true, primary: "ai", fallback: "ai" },
    });
    expect(enginesInUse(settings)).toEqual(["ai"]);
    expect(enginesInUse({ ...settings, fallback: "google" })).toEqual([
      "ai",
      "google",
    ]);
  });
});
