import { describe, expect, it } from "vitest";

import {
  BaseUrlSchema,
  DEFAULT_MODEL_CATALOG,
  ModelCatalogSchema,
  modelChoiceErrors,
  modelsOf,
  modelWarning,
  narrowCatalog,
  narrowProviders,
  type AiPolicy,
} from "./models";

const policy: AiPolicy = {
  providers: ["openai", "openrouter"],
  models: { openai: ["gpt-5-mini", "gpt-5"], openrouter: [] },
};

describe("AI providers and models (CF6a)", () => {
  it("narrows providers and catalogs", () => {
    expect(
      narrowProviders(["openai", "gemini"], ["gemini", "anthropic"]),
    ).toEqual(["gemini"]);
    expect(
      narrowCatalog(
        { openai: ["a", "b", "c"], gemini: [], anthropic: ["x"] },
        { openai: ["c", "a", "z"], gemini: ["g1"] },
      ),
    ).toEqual({ openai: ["c", "a"], gemini: ["g1"], anthropic: ["x"] });
  });

  it("reads the models offered: an empty list leaves the model free", () => {
    expect(modelsOf(policy, "openai")).toEqual(["gpt-5-mini", "gpt-5"]);
    expect(modelsOf(policy, "openrouter")).toBeNull();
    expect(modelsOf(policy, "nope")).toBeNull();
  });

  it("warns about a saved choice outside the policy", () => {
    expect(modelWarning(policy, "openai", "gpt-5")).toBeNull();
    expect(modelWarning(policy, "openai", "gpt-4o")).toBe("model_off");
    expect(modelWarning(policy, "anthropic", "claude-sonnet-5-5")).toBe(
      "provider_off",
    );
    expect(modelWarning(policy, "openrouter", "any/model")).toBeNull();
    expect(modelWarning(policy, null, null)).toBeNull();
  });

  it("checks only what changed", () => {
    const old = { provider: "anthropic", model: "claude-sonnet-5-5" };
    expect(modelChoiceErrors(policy, old, old)).toEqual({});
    expect(
      // Provider off but unchanged, and no catalog for it: kept.
      modelChoiceErrors(policy, old, {
        provider: "anthropic",
        model: "claude-x",
      }),
    ).toEqual({});
    expect(
      modelChoiceErrors(
        policy,
        { provider: "openai", model: "gpt-5" },
        { provider: "anthropic", model: "claude-x" },
        "model.model_provider",
      ),
    ).toEqual({ "model.model_provider": "provider_off" });
    expect(
      modelChoiceErrors(
        policy,
        { provider: "openai", model: "gpt-5" },
        { provider: "openai", model: "gpt-4o" },
      ),
    ).toEqual({ "model.model_name": "model_off" });
    expect(
      modelChoiceErrors(
        policy,
        {},
        { provider: "openai", model: "gpt-5-mini" },
      ),
    ).toEqual({});
  });

  it("validates catalogs and base URLs", () => {
    expect(ModelCatalogSchema.safeParse(DEFAULT_MODEL_CATALOG).success).toBe(
      true,
    );
    expect(ModelCatalogSchema.safeParse({ openai: ["a", "a"] }).success).toBe(
      false,
    );
    expect(
      ModelCatalogSchema.safeParse({ openai: ["bad model"] }).success,
    ).toBe(false);
    expect(ModelCatalogSchema.safeParse({ other: ["x"] }).success).toBe(false);
    expect(BaseUrlSchema.safeParse("https://gw.example.com/v1").success).toBe(
      true,
    );
    expect(BaseUrlSchema.safeParse("http://gw.example.com/v1").success).toBe(
      false,
    );
    expect(BaseUrlSchema.safeParse("https://u:p@gw.example.com").success).toBe(
      false,
    );
    expect(BaseUrlSchema.safeParse("https://gw.example.com/?k=1").success).toBe(
      false,
    );
  });
});
