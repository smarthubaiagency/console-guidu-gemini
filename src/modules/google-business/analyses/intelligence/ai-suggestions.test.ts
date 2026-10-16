import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AnalysisContext, ReviewSummary } from "../contract";
import {
  createEngineSuggestionsAi,
  createFakeSuggestionsAi,
  getSuggestionsAi,
  type SuggestionsAi,
} from "./ai-engine";
import type { AiSuggestions } from "./ai-schema";
import { aiSuggestionsAnalysis, buildSuggestionsInput } from "./ai-suggestions";
import { runWithIntelligenceRuntime } from "./runtime";

const NOW = "2026-10-16T12:00:00.000Z";

function review(id: string, rating: ReviewSummary["rating"], text: string | null, replied = false): ReviewSummary {
  return {
    externalId: id,
    rating,
    text,
    authorName: "Ana Souza",
    createdAt: NOW,
    replied,
    replyText: replied ? "Obrigado!" : null,
  };
}

const CONTEXT: AnalysisContext = {
  request: { userId: "u", workspaceId: "w", organizationId: "o" },
  locationId: "gb-location",
  unitId: "unit",
  snapshot: {
    provider: "fake",
    externalId: "x",
    placeId: "p",
    name: "Clínica Sorriso",
    primaryCategory: "Dentista",
    additionalCategories: [],
    description: "Clínica com 20% de desconto em clareamento.",
    phone: null,
    website: null,
    address: { lines: [], locality: "Campinas", administrativeArea: "SP", postalCode: null, countryCode: "BR" },
    latitude: null,
    longitude: null,
    timeZone: null,
    regularHours: [],
    specialHours: [],
    rating: 4.5,
    reviewCount: 3,
    photoCount: 0,
    attributes: {},
    readAt: NOW,
  },
  reviews: [
    review("r1", 5, "A Juliana foi ótima e o implante ficou perfeito."),
    review("r2", 1, "Esperei muito."),
    review("r3", 4, "Bom", true),
  ],
};

/** Runs the analysis with the given AI and no database. */
function run(ai: SuggestionsAi | null) {
  return runWithIntelligenceRuntime(
    {
      ai,
      maps: null,
      locator: null,
      transaction: async () => {
        throw new Error("no database in this test");
      },
    },
    () => aiSuggestionsAnalysis.run(CONTEXT),
  );
}

function aiAnswering(answer: unknown): SuggestionsAi {
  return { id: "fake", suggest: async () => answer };
}

const SAFE: AiSuggestions = {
  description: { suggested: "Clínica odontológica em Campinas, com atendimento de segunda a sábado e equipe experiente." },
  name: { hasKeywords: false, suggested: null },
  categories: { primary: "Dentista", additional: ["Clínica odontológica"] },
  replies: [
    { reviewId: "r1", text: "Obrigado pela visita, Ana! A Juliana e toda a equipe agradecem." },
    { reviewId: "r2", text: "Sentimos muito, Ana. Fale com a gente pelos canais de atendimento." },
  ],
};

describe("AI suggestions analysis (GB1b)", () => {
  it("declares the contract: blocking, our AI key, info area", () => {
    expect(aiSuggestionsAnalysis).toMatchObject({
      key: "ai-suggestions",
      phase: "blocking",
      usesAi: true,
      area: "info",
      labelKey: "gbIntelligence.steps.aiSuggestions",
    });
  });

  it("sends only public data and the reviews without a reply", () => {
    const input = buildSuggestionsInput(CONTEXT);
    expect(input.language).toBe("pt-BR");
    expect(input.reviews.map((r) => r.reviewId)).toEqual(["r1", "r2"]);
    expect(input.reviews[0]!.authorFirstName).toBe("Ana");
  });

  it("works with the fake AI and stays within the rules", async () => {
    const result = await run(createFakeSuggestionsAi());
    expect(result.status).toBe("done");
    const keys = result.findings.map((f) => f.key);
    // The current description has a promotion: flagged, with the clean one.
    expect(keys).toContain("description-policy");
    expect(keys).toContain("reply-r1");
    expect(keys).toContain("reply-r2");
    const policy = result.findings.find((f) => f.key === "description-policy")!;
    expect(policy).toMatchObject({ area: "info", severity: "high", values: { problem: "promotion" } });
    expect(policy.suggested).toBeTruthy();
    expect(result.metrics).toMatchObject({ replyDrafts: 2, repliesFiltered: 0 });
    for (const finding of result.findings) {
      expect(finding.titleKey).toMatch(/^gbIntelligence\.findings\.[a-zA-Z]+\.title$/);
      expect(finding.source).toBe("ai");
    }
  });

  it("replaces a reply that names an employee or confirms a treatment", async () => {
    const result = await run(
      aiAnswering({
        ...SAFE,
        replies: [
          { reviewId: "r1", text: "Que bom que o implante ficou perfeito! A Juliana agradece." },
          { reviewId: "r2", text: "Sentimos muito, Ana. Fale com a gente pelos canais de atendimento." },
        ],
      }),
    );
    const r1 = result.findings.find((f) => f.key === "reply-r1")!;
    expect(r1.values).toMatchObject({ origin: "template", rating: 5 });
    expect(r1.suggested).not.toMatch(/implante|Juliana/);
    const r2 = result.findings.find((f) => f.key === "reply-r2")!;
    expect(r2).toMatchObject({ severity: "high", values: { origin: "ai" } });
    expect(result.metrics).toMatchObject({ repliesFiltered: 1, repliesTemplated: 1 });
  });

  it("names the staff rule too when the treatment is not mentioned", async () => {
    const result = await run(aiAnswering(SAFE));
    expect(result.findings.find((f) => f.key === "reply-r1")!.values).toMatchObject({ origin: "template" });
  });

  it("drops a suggested description with a link and fills missing drafts", async () => {
    const result = await run(
      aiAnswering({
        ...SAFE,
        description: { suggested: "Visite www.clinicasorriso.com.br" },
        name: { hasKeywords: true, suggested: "Clínica Sorriso" },
        replies: [],
      }),
    );
    const policy = result.findings.find((f) => f.key === "description-policy")!;
    expect(policy.suggested).toBeNull();
    expect(result.metrics).toMatchObject({ descriptionSuggested: 0, repliesTemplated: 2 });
    // The suggested name equals the current: flagged, nothing to suggest.
    expect(result.findings.find((f) => f.key === "name-keywords")).toMatchObject({ suggested: null, severity: "high" });
  });

  it("fails on an answer outside the schema and skips without AI", async () => {
    const invalid = await run(aiAnswering({ description: "texto solto", replies: "x" }));
    expect(invalid).toMatchObject({ status: "failed", findings: [] });
    expect(invalid.error).toMatch(/schema/);
    const tooLong = await run(aiAnswering({ ...SAFE, description: { suggested: "x".repeat(751) } }));
    expect(tooLong.status).toBe("failed");
    expect(await run(null)).toMatchObject({ status: "skipped" });
  });

  it("skips when the partner has no key and model, using our key resolver", async () => {
    const result = await runWithIntelligenceRuntime(
      { ai: createEngineSuggestionsAi(), transaction: async () => null as never },
      () => aiSuggestionsAnalysis.run(CONTEXT),
    );
    expect(result).toMatchObject({ status: "skipped" });
    expect(result.error).toMatch(/No AI key/);
  });

  it("calls the engine with a structured answer (mock model, no network)", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify(SAFE) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
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
    expect(prompt).toContain("Never confirm that the person is a customer of anything sensitive");
    expect(prompt).not.toContain("sk-test");
  });

  it("uses the fake only when the environment asks for it", () => {
    expect(getSuggestionsAi({ GB_SUGGESTIONS_PROVIDER: "fake" }).id).toBe("fake");
    expect(getSuggestionsAi({}).id).toBe("engine");
  });
});
