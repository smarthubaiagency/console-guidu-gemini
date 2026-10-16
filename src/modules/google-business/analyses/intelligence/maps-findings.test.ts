import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildDemoMapsView } from "../../components/maps/demo-data";
import { gridMetrics } from "../../maps/metrics";
import type { ReviewStats } from "../../maps/reviews";
import type { AnalysisFinding } from "../contract";
import { stepLabel } from "./findings";
import {
  competitorFindings,
  geoGridFindings,
  type KeywordOutcome,
  solvBand,
} from "./maps-findings";

const ROOT = path.resolve(__dirname, "../../../../i18n/messages");

function messages(locale: string): Record<string, unknown> {
  return {
    gbIntelligence: JSON.parse(
      readFileSync(path.join(ROOT, locale, "gbIntelligence.json"), "utf8"),
    ),
  };
}

function lookup(tree: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    tree,
  );
}

const LOCALES = ["pt-BR", "en", "es"].map((locale) => [locale, messages(locale)] as const);

function expectTranslated(findings: readonly AnalysisFinding[]) {
  for (const finding of findings) {
    for (const [locale, tree] of LOCALES) {
      expect(typeof lookup(tree, finding.titleKey), `${locale} ${finding.titleKey}`).toBe("string");
      expect(typeof lookup(tree, finding.detailKey), `${locale} ${finding.detailKey}`).toBe("string");
    }
  }
}

const WEAK_STATS: ReviewStats = {
  rating: 4.1,
  reviewCount: 20,
  monthly: [],
  monthlyAverage: 0.5,
  daysSinceLast: 45,
  longestGapDays: 60,
  distribution: { "1": 2, "2": 1, "3": 2, "4": 5, "5": 10 },
  responseRate: 40,
  unanswered: 12,
  competitorMedianRating: 4.7,
  competitorMedianReviews: 150,
  competitorCount: 10,
  burstDays: 2,
};

describe("findings of the Saúde no Maps (GB1b)", () => {
  it("never shows a weak point without the action, in the three languages", async () => {
    const view = await buildDemoMapsView();
    const outcomes: KeywordOutcome[] = view.keywords.map((keyword, index) => ({
      keyword: keyword.keyword,
      metrics: gridMetrics(
        index === 0 ? keyword.ranks.map((row) => row.map(() => null)) : keyword.ranks,
      ),
      competitors: keyword.competitors,
      neighborhoods: index === 1 ? [] : keyword.neighborhoods,
      newCompetitors: index === 2 ? keyword.competitors.slice(0, 2) : [],
    }));
    const score = { score: view.score ?? 0, breakdown: view.breakdown };
    const grid = [
      ...geoGridFindings({ outcomes, score, isBaseline: true, baseline: null }),
      ...geoGridFindings({ outcomes, score, isBaseline: false, baseline: { score: 30, solv: 10 } }),
    ];
    const competitors = competitorFindings({ outcomes, reviews: WEAK_STATS });
    expectTranslated([...grid, ...competitors]);

    // Weak points carry the action in the detail of the same finding.
    const weak = [...grid, ...competitors].filter((f) => f.severity !== "low");
    expect(weak.length).toBeGreaterThan(5);
    const pt = LOCALES[0]![1];
    for (const finding of weak) {
      const detail = lookup(pt, finding.detailKey) as string;
      if (finding.titleKey.endsWith(".progress.title")) continue;
      expect(detail, finding.titleKey).toMatch(/Ação/);
    }
    expect(grid.find((f) => f.key === "maps-solv-1")).toMatchObject({ severity: "critical" });
    expect(competitors.filter((f) => f.titleKey.includes("newCompetitor"))).toHaveLength(2);
    expect(competitors.map((f) => f.key)).toEqual(
      expect.arrayContaining(["reviews-pace", "reviews-gap", "reviews-response", "reviews-rating", "reviews-count", "reviews-burst"]),
    );
    const scoreFinding = grid.find((f) => f.key === "maps-score")!;
    expect(scoreFinding.values).toMatchObject({ score: view.score });
  });

  it("puts the SoLV in bands", () => {
    const metrics = (solv: number, found = 10) => ({
      totalPoints: 49, foundPoints: found, top3Points: 0, solv, averageRank: 5, visibility: 0, weakestDirection: null,
    });
    expect(solvBand(metrics(0, 0))).toBe("notFound");
    expect(solvBand(metrics(20))).toBe("solvWeak");
    expect(solvBand(metrics(45))).toBe("solvModerate");
    expect(solvBand(metrics(80))).toBe("solvStrong");
  });

  it("has every message the analyses use, in the three languages", () => {
    const ids = [
      "keywordsNone", "keywordsChosen", "keywordsKept", "mapsQuota", "mapsNoCoordinates",
      "description", "descriptionPolicy", "nameKeywords", "categories", "reply",
    ];
    for (const [locale, tree] of LOCALES) {
      for (const id of ids) {
        expect(typeof lookup(tree, `gbIntelligence.findings.${id}.title`), `${locale} ${id}`).toBe("string");
        expect(typeof lookup(tree, `gbIntelligence.findings.${id}.detail`), `${locale} ${id}`).toBe("string");
      }
      for (const step of ["ai-suggestions", "maps-keywords", "maps-competitors", "maps-geo-grid"]) {
        expect(typeof lookup(tree, stepLabel(step)), `${locale} ${step}`).toBe("string");
      }
    }
  });
});
