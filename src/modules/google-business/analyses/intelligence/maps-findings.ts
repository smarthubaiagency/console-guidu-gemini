import type { AnalysisFinding } from "../contract";
import type { CompetitorStat } from "../../maps/competitors";
import type { GridMetrics } from "../../maps/metrics";
import type { ReviewStats } from "../../maps/reviews";
import {
  type HealthScore,
  SCORE_REFERENCES,
  weakestDimension,
} from "../../maps/score";
import { finding } from "./findings";

/**
 * Findings of the Saúde no Maps (GB1b). Rule of the documento técnico
 * (§7.7), decided by Marcelo: no weak point of the map is shown without the
 * action next to it, in the same finding (the detail message carries it).
 * Proximity weighs and no content fixes being far; the real actions are the
 * neighbourhood vocabulary and watching new competitors.
 */

export type KeywordOutcome = Readonly<{
  keyword: string;
  metrics: GridMetrics;
  competitors: readonly CompetitorStat[];
  neighborhoods: readonly string[];
  newCompetitors: readonly CompetitorStat[];
}>;

const round1 = (value: number) => Math.round(value * 10) / 10;

export function solvBand(
  metrics: GridMetrics,
): "notFound" | "solvWeak" | "solvModerate" | "solvStrong" {
  if (metrics.foundPoints === 0) return "notFound";
  if (metrics.solv < 40) return "solvWeak";
  if (metrics.solv < 60) return "solvModerate";
  return "solvStrong";
}

const SOLV_SEVERITY = {
  notFound: "critical",
  solvWeak: "high",
  solvModerate: "medium",
  solvStrong: "low",
} as const;

export function geoGridFindings(
  input: Readonly<{
    outcomes: readonly KeywordOutcome[];
    score: HealthScore;
    isBaseline: boolean;
    baseline: Readonly<{ score: number | null; solv: number }> | null;
  }>,
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const points = Object.fromEntries(
    input.score.breakdown.map((dimension) => [
      dimension.key,
      round1(dimension.points),
    ]),
  );
  const weakest = weakestDimension(input.score);
  findings.push(
    finding({
      key: "maps-score",
      titleKey: "score",
      area: "maps",
      severity:
        input.score.score < 40
          ? "high"
          : input.score.score < 60
            ? "medium"
            : "low",
      source: "maps",
      values: {
        score: input.score.score,
        visibility: points.visibility ?? 0,
        reviews: points.reviews ?? 0,
        activity: points.activity ?? 0,
        profile: points.profile ?? 0,
        weakest: weakest?.key ?? "none",
      },
    }),
  );

  input.outcomes.forEach((outcome, index) => {
    const band = solvBand(outcome.metrics);
    findings.push(
      finding({
        key: `maps-solv-${index + 1}`,
        titleKey: band,
        area: "maps",
        severity: SOLV_SEVERITY[band],
        source: "maps",
        values: {
          keyword: outcome.keyword,
          solv: round1(outcome.metrics.solv),
          top3: outcome.metrics.top3Points,
          found: outcome.metrics.foundPoints,
          total: outcome.metrics.totalPoints,
          averageRank:
            outcome.metrics.averageRank === null
              ? "-"
              : round1(outcome.metrics.averageRank),
          direction: outcome.metrics.weakestDirection ?? "none",
          vocabulary: outcome.neighborhoods.length > 0 ? "yes" : "no",
          neighborhoods: outcome.neighborhoods.join(", "),
        },
      }),
    );
  });

  const solvs = input.outcomes.map((o) => o.metrics.solv);
  const meanSolv =
    solvs.length > 0
      ? round1(solvs.reduce((a, b) => a + b, 0) / solvs.length)
      : 0;
  if (input.isBaseline) {
    findings.push(
      finding({
        key: "maps-baseline",
        titleKey: "baseline",
        area: "maps",
        severity: "low",
        source: "maps",
        values: { solv: meanSolv, score: input.score.score },
      }),
    );
  } else if (input.baseline) {
    findings.push(
      finding({
        key: "maps-progress",
        titleKey: "progress",
        area: "maps",
        severity: meanSolv < input.baseline.solv ? "medium" : "low",
        source: "maps",
        values: {
          baselineSolv: round1(input.baseline.solv),
          solv: meanSolv,
          baselineScore: input.baseline.score ?? "-",
          score: input.score.score,
        },
      }),
    );
  }
  return findings;
}

export function competitorFindings(
  input: Readonly<{
    outcomes: readonly KeywordOutcome[];
    reviews: ReviewStats;
  }>,
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const reported = new Set<string>();
  input.outcomes.forEach((outcome, index) => {
    const leader = outcome.competitors[0];
    findings.push(
      finding({
        key: `maps-competitors-${index + 1}`,
        titleKey: "competitors",
        area: "maps",
        severity: "low",
        source: "maps",
        values: {
          keyword: outcome.keyword,
          count: outcome.competitors.length,
          leader: leader?.name ?? "-",
          leaderRating: leader?.rating ?? "-",
          leaderReviews: leader?.reviews ?? 0,
        },
      }),
    );
    for (const competitor of outcome.newCompetitors) {
      const id = competitor.placeId ?? competitor.name;
      if (reported.has(id)) continue;
      reported.add(id);
      findings.push(
        finding({
          key: `new-competitor-${reported.size}`,
          titleKey: "newCompetitor",
          area: "maps",
          severity: "high",
          source: "maps",
          values: {
            name: competitor.name,
            keyword: outcome.keyword,
            rating: competitor.rating ?? "-",
            reviews: competitor.reviews ?? 0,
            averageRank: round1(competitor.averageRank),
          },
        }),
      );
    }
  });
  findings.push(...reviewFindings(input.reviews));
  return findings;
}

export function reviewFindings(stats: ReviewStats): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const lowPace = stats.monthlyAverage < SCORE_REFERENCES.monthlyPace;
  findings.push(
    finding({
      key: "reviews-pace",
      titleKey: lowPace ? "reviewsPaceLow" : "reviewsPace",
      area: "reviews",
      severity: lowPace ? "medium" : "low",
      source: "maps",
      values: {
        monthly: stats.monthlyAverage,
        days: stats.daysSinceLast ?? "-",
        reference: SCORE_REFERENCES.monthlyPace,
      },
    }),
  );
  if (stats.longestGapDays !== null && stats.longestGapDays >= 30) {
    findings.push(
      finding({
        key: "reviews-gap",
        titleKey: "reviewsGap",
        area: "reviews",
        severity: "medium",
        source: "maps",
        values: { days: stats.longestGapDays },
      }),
    );
  }
  if (stats.responseRate !== null) {
    const low = stats.responseRate < 80;
    findings.push(
      finding({
        key: "reviews-response",
        titleKey: low ? "responseLow" : "responseGood",
        area: "reviews",
        severity: low ? (stats.responseRate < 50 ? "high" : "medium") : "low",
        source: "maps",
        values: { rate: round1(stats.responseRate), pending: stats.unanswered },
      }),
    );
  }
  if (
    stats.rating !== null &&
    stats.competitorMedianRating !== null &&
    stats.rating < stats.competitorMedianRating
  ) {
    findings.push(
      finding({
        key: "reviews-rating",
        titleKey: "ratingBelow",
        area: "reviews",
        severity: "high",
        source: "maps",
        values: { rating: stats.rating, median: stats.competitorMedianRating },
      }),
    );
  }
  if (
    stats.competitorMedianReviews !== null &&
    stats.reviewCount < stats.competitorMedianReviews
  ) {
    findings.push(
      finding({
        key: "reviews-count",
        titleKey: "countBelow",
        area: "reviews",
        severity: "medium",
        source: "maps",
        values: {
          count: stats.reviewCount,
          median: Math.round(stats.competitorMedianReviews),
        },
      }),
    );
  }
  if (stats.burstDays > 0) {
    findings.push(
      finding({
        key: "reviews-burst",
        titleKey: "reviewsBurst",
        area: "reviews",
        severity: "medium",
        source: "maps",
        values: { days: stats.burstDays },
      }),
    );
  }
  findings.push(
    finding({
      key: "reviews-distribution",
      titleKey: "reviewsDistribution",
      area: "reviews",
      severity: "low",
      source: "maps",
      values: {
        five: stats.distribution["5"],
        four: stats.distribution["4"],
        three: stats.distribution["3"],
        two: stats.distribution["2"],
        one: stats.distribution["1"],
      },
    }),
  );
  return findings;
}
