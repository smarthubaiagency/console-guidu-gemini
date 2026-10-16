import "server-only";

import { appLog } from "@/lib/telemetry/log";

import type {
  AnalysisContext,
  AnalysisFinding,
  AnalysisResult,
  LocationAnalysis,
  ReviewSummary,
} from "../contract";
import { languageOfCountry } from "../../maps/keywords";
import {
  resolveIntelligenceKey,
  SuggestionsUnavailableError,
} from "./ai-engine";
import {
  descriptionProblems,
  firstName,
  namesKeyword,
  replyProblems,
  templateReply,
} from "./ai-safety";
import {
  type AiSuggestions,
  AiSuggestionsSchema,
  MAX_REPLY_DRAFTS,
  type SuggestionsInput,
  type SuggestionsLanguage,
} from "./ai-schema";
import { finding, stepLabel } from "./findings";
import { currentRuntime } from "./runtime";

/**
 * AI suggestions by area (GB1b, especificação §5, §9 and §6.1), a blocking
 * analysis of the onboarding: description (current × suggested), name
 * without keywords, categories, and drafts for the reviews without a reply.
 * Uses OUR key (`usesAi`, see `./ai-engine.ts`). Only reads and suggests:
 * nothing is changed on the profile. The answer is validated by Zod and
 * then by the safety filters of `./ai-safety.ts`.
 */

const LANGUAGES: Record<string, SuggestionsLanguage> = {
  pt: "pt-BR",
  es: "es",
  en: "en",
};

export function suggestionsLanguage(
  countryCode: string | null | undefined,
): SuggestionsLanguage {
  return LANGUAGES[languageOfCountry(countryCode)] ?? "pt-BR";
}

/** Newest reviews without a reply, the ones that get a draft. */
export function unansweredReviews(
  reviews: readonly ReviewSummary[],
): ReviewSummary[] {
  return reviews
    .filter((review) => !review.replied)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_REPLY_DRAFTS);
}

export function buildSuggestionsInput(
  context: AnalysisContext,
): SuggestionsInput {
  const { snapshot } = context;
  return {
    language: suggestionsLanguage(snapshot.address?.countryCode),
    business: {
      name: snapshot.name,
      primaryCategory: snapshot.primaryCategory,
      additionalCategories: snapshot.additionalCategories,
      description: snapshot.description,
      locality: snapshot.address?.locality ?? null,
      website: snapshot.website,
    },
    reviews: unansweredReviews(context.reviews).map((review) => ({
      reviewId: review.externalId,
      rating: review.rating,
      text: review.text?.slice(0, 2000) ?? null,
      authorFirstName: firstName(review.authorName),
    })),
  };
}

function severityOfRating(rating: number): AnalysisFinding["severity"] {
  if (rating <= 2) return "high";
  if (rating === 3) return "medium";
  return "low";
}

/** From the validated answer to the findings, filtering what breaks a rule. */
export function suggestionFindings(
  context: AnalysisContext,
  input: SuggestionsInput,
  answer: AiSuggestions,
): { findings: AnalysisFinding[]; metrics: Record<string, number> } {
  const { snapshot } = context;
  const findings: AnalysisFinding[] = [];
  const current = snapshot.description?.trim() || null;

  // Description: the current one breaking a rule is a finding of its own.
  const currentProblems = current ? descriptionProblems(current) : [];
  const suggested = answer.description?.suggested ?? null;
  const suggestedProblems = suggested ? descriptionProblems(suggested) : [];
  const cleanSuggestion =
    suggested && suggestedProblems.length === 0 ? suggested : null;
  if (suggested && suggestedProblems.length > 0) {
    appLog.warn("google_business.ai.description_filtered", {
      problems: suggestedProblems.join(","),
    });
  }
  if (currentProblems.length > 0) {
    findings.push(
      finding({
        key: "description-policy",
        area: "info",
        severity: "high",
        source: "ai",
        values: { problem: currentProblems[0]! },
        current,
        suggested: cleanSuggestion,
      }),
    );
  } else if (cleanSuggestion && cleanSuggestion !== current) {
    findings.push(
      finding({
        key: "description",
        area: "info",
        severity: !current || current.length < 250 ? "medium" : "low",
        source: "ai",
        values: { length: current?.length ?? 0 },
        current,
        suggested: cleanSuggestion,
      }),
    );
  }

  // Name: keywords, city or slogan (§9.2), by the AI or by the category.
  const stuffed =
    answer.name.hasKeywords ||
    namesKeyword(snapshot.name, [
      snapshot.primaryCategory,
      snapshot.address?.locality ?? null,
    ]);
  if (stuffed) {
    const name = answer.name.suggested?.trim() || null;
    findings.push(
      finding({
        key: "name-keywords",
        area: "info",
        severity: "high",
        source: "ai",
        current: snapshot.name,
        suggested:
          name &&
          name !== snapshot.name &&
          descriptionProblems(name).length === 0
            ? name
            : null,
      }),
    );
  }

  // Categories, when the suggestion differs from what is there.
  if (answer.categories) {
    const now = [snapshot.primaryCategory, ...snapshot.additionalCategories]
      .filter(Boolean)
      .join(", ");
    const next = [answer.categories.primary, ...answer.categories.additional]
      .filter(Boolean)
      .join(", ");
    if (next && next.toLowerCase() !== now.toLowerCase()) {
      findings.push(
        finding({
          key: "categories",
          area: "info",
          severity: snapshot.primaryCategory ? "low" : "high",
          source: "ai",
          values: { count: snapshot.additionalCategories.length },
          current: now || null,
          suggested: next,
        }),
      );
    }
  }

  // A draft for every review without a reply; unsafe ones become templates.
  const drafts = new Map(
    answer.replies.map((reply) => [reply.reviewId, reply.text]),
  );
  let filtered = 0;
  let templated = 0;
  for (const review of input.reviews) {
    const draft = drafts.get(review.reviewId) ?? null;
    let text = draft;
    if (draft) {
      const problems = replyProblems(draft, {
        reviewText: review.text,
        authorFirstName: review.authorFirstName,
        businessName: snapshot.name,
      });
      if (problems.length > 0) {
        filtered += 1;
        text = null;
        appLog.warn("google_business.ai.reply_filtered", {
          problems: problems.join(","),
        });
      }
    }
    if (!text) {
      templated += 1;
      text = templateReply(
        input.language,
        review.rating,
        review.authorFirstName,
      );
    }
    findings.push(
      finding({
        key: `reply-${review.reviewId}`,
        titleKey: "reply",
        area: "reviews",
        severity: severityOfRating(review.rating),
        source: "ai",
        values: {
          rating: review.rating,
          author: review.authorFirstName ?? "",
          origin: draft && text === draft ? "ai" : "template",
        },
        current: review.text,
        suggested: text,
      }),
    );
  }

  return {
    findings,
    metrics: {
      replyDrafts: input.reviews.length,
      repliesFiltered: filtered,
      repliesTemplated: templated,
      descriptionSuggested: cleanSuggestion ? 1 : 0,
    },
  };
}

export async function runAiSuggestions(
  context: AnalysisContext,
): Promise<AnalysisResult> {
  const runtime = currentRuntime();
  if (!runtime.ai) {
    return {
      status: "skipped",
      findings: [],
      error: "AI suggestions are not available here",
    };
  }
  const input = buildSuggestionsInput(context);
  let raw: unknown;
  try {
    raw = await runtime.ai.suggest(input, () =>
      runtime.transaction(context.request, (tx) => resolveIntelligenceKey(tx)),
    );
  } catch (error) {
    if (error instanceof SuggestionsUnavailableError) {
      return { status: "skipped", findings: [], error: error.message };
    }
    appLog.warn("google_business.ai.failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return {
      status: "failed",
      findings: [],
      error: "The AI suggestions call failed",
    };
  }
  const parsed = AiSuggestionsSchema.safeParse(raw);
  if (!parsed.success) {
    appLog.warn("google_business.ai.invalid_answer", {
      issues: parsed.error.issues.length,
    });
    return {
      status: "failed",
      findings: [],
      error: "The AI answer did not match the schema",
    };
  }
  const { findings, metrics } = suggestionFindings(context, input, parsed.data);
  return { status: "done", findings, metrics };
}

export const aiSuggestionsAnalysis: LocationAnalysis = {
  key: "ai-suggestions",
  area: "info",
  phase: "blocking",
  labelKey: stepLabel("ai-suggestions"),
  usesAi: true,
  run: runAiSuggestions,
};
