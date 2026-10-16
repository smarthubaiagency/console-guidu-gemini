import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GOOGLE_BUSINESS_SPECIALIST, getSpecialist } from "./definitions";
import { askSpecialist, fakeSpecialistAnswer } from "./turn";

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

describe("specialist agent (ADR 0019, GB1a)", () => {
  it("is a specialist of the platform with no tools", () => {
    expect(getSpecialist("google-business")).toBe(GOOGLE_BUSINESS_SPECIALIST);
    expect(GOOGLE_BUSINESS_SPECIALIST).toMatchObject({
      kind: "specialist",
      tools: [],
    });
    expect(GOOGLE_BUSINESS_SPECIALIST.instructions).toMatch(
      /cannot change anything/,
    );
  });

  it("answers with a fixed text in tests, without loading a key", async () => {
    const loadKey = vi.fn();
    const answer = await askSpecialist(
      GOOGLE_BUSINESS_SPECIALIST,
      {
        question: "O que é a defesa?",
        history: [],
        context: "x",
        locale: "pt-BR",
      },
      loadKey,
      { env: { GOOGLE_BUSINESS_SPECIALIST_PROVIDER: "fake" } },
    );
    expect(answer.text).toBe(fakeSpecialistAnswer("O que é a defesa?"));
    expect(loadKey).not.toHaveBeenCalled();
  });

  it("calls the model with our key, the context and the history", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: "A defesa avisa mudanças." }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
        warnings: [],
      }),
    });
    const answer = await askSpecialist(
      GOOGLE_BUSINESS_SPECIALIST,
      {
        question: "E a defesa?",
        history: [
          { role: "user", content: "Oi" },
          { role: "assistant", content: "Olá" },
        ],
        context: "Ficha: Padaria",
        locale: "pt-BR",
      },
      async () => ({
        provider: "openai",
        secret: "sk-test",
        model: "modelo-x",
      }),
      { env: {}, createModel: () => model },
    );
    expect(answer).toEqual({
      text: "A defesa avisa mudanças.",
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "modelo-x",
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Ficha: Padaria");
    expect(prompt).toContain("E a defesa?");
    expect(prompt).toContain("Olá");
  });

  it("turns a model failure into a safe error", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("down");
      },
    });
    await expect(
      askSpecialist(
        GOOGLE_BUSINESS_SPECIALIST,
        { question: "?", history: [], context: "", locale: "pt-BR" },
        async () => ({ provider: "openai", secret: "s", model: "m" }),
        { env: {}, createModel: () => model },
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
