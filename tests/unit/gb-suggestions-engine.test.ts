import { MockLanguageModelV4 } from "ai/test";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AnalysisContext } from "@/modules/google-business/analyses/contract";
import { createEngineSuggestionsAi } from "@/modules/google-business/analyses/intelligence/ai-engine";
import type { AiSuggestions } from "@/modules/google-business/analyses/intelligence/ai-schema";
import { buildSuggestionsInput } from "@/modules/google-business/analyses/intelligence/ai-suggestions";

/**
 * The AI suggestions of the agent GMN (GB1b) through the engine, with a
 * mock model: the structured answer comes back parsed, the instructions
 * carry the rules of section 9 and the key never reaches the prompt. Lives
 * outside src/ because only src/core/ai may import the AI SDK (ADR 0017).
 */

const NOW = "2026-10-16T12:00:00.000Z";

const CONTEXT: AnalysisContext = {
  request: { userId: "u", workspaceId: "w", organizationId: "o" },
  locationId: "gb",
  unitId: "unit",
  snapshot: {
    provider: "fake",
    externalId: "x",
    placeId: "p",
    name: "Clínica Sorriso",
    primaryCategory: "Dentista",
    additionalCategories: [],
    description: null,
    phone: null,
    website: null,
    address: null,
    latitude: null,
    longitude: null,
    timeZone: null,
    regularHours: [],
    specialHours: [],
    rating: 4.5,
    reviewCount: 1,
    photoCount: 0,
    attributes: {},
    readAt: NOW,
  },
  reviews: [
    {
      externalId: "r1",
      rating: 5,
      text: "Ótimo",
      authorName: "Ana",
      createdAt: NOW,
      replied: false,
      replyText: null,
    },
  ],
};

const SAFE: AiSuggestions = {
  description: {
    suggested: "Clínica odontológica com atendimento de segunda a sábado.",
  },
  name: { hasKeywords: false, suggested: null },
  categories: null,
  replies: [{ reviewId: "r1", text: "Obrigado pela visita, Ana!" }],
};

it("calls the engine with a structured answer (mock model, no network)", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(SAFE) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    },
  });
  const ai = createEngineSuggestionsAi(() => model);
  const answer = await ai.suggest(buildSuggestionsInput(CONTEXT), async () => ({
    provider: "anthropic",
    secret: "sk-test",
    model: "configured-by-the-partner",
  }));
  expect(answer).toEqual(SAFE);
  const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
  expect(prompt).toContain(
    "Never confirm that the person is a customer of anything sensitive",
  );
  expect(prompt).not.toContain("sk-test");
});
