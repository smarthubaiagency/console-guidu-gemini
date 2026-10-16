import type {
  LocationAnalysis,
  LocationSnapshot,
  ReviewSummary,
} from "../contract";
import { checklistResult, type ChecklistItem } from "./checklist";

/** Response rate considered in order. */
export const RESPONSE_RATE_TARGET = 0.8;

export type ReviewStats = Readonly<{
  /** Reviews read (most recent ones). */
  read: number;
  rating: number | null;
  reviewCount: number;
  unanswered: number;
  unansweredNegative: number;
  /** 0 to 100, null without reviews. */
  responseRate: number | null;
  last30Days: number;
  distribution: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
}>;

export function reviewStats(
  snapshot: LocationSnapshot,
  reviews: readonly ReviewSummary[],
): ReviewStats {
  const since = Date.parse(snapshot.readAt) - 30 * 86_400_000;
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of reviews) distribution[review.rating] += 1;
  const unanswered = reviews.filter((r) => !r.replied);
  const average =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;
  return {
    read: reviews.length,
    rating:
      snapshot.rating ??
      (average === null ? null : Math.round(average * 10) / 10),
    reviewCount: Math.max(snapshot.reviewCount, reviews.length),
    unanswered: unanswered.length,
    unansweredNegative: unanswered.filter((r) => r.rating <= 2).length,
    responseRate:
      reviews.length > 0
        ? Math.round(
            ((reviews.length - unanswered.length) / reviews.length) * 100,
          )
        : null,
    last30Days: reviews.filter((r) => Date.parse(r.createdAt) >= since).length,
    distribution,
  };
}

export function reviewsChecklist(stats: ReviewStats): ChecklistItem[] {
  return [
    {
      key: "reviews-unanswered",
      ok: stats.read === 0 ? null : stats.unanswered === 0,
      severity: stats.unansweredNegative > 0 ? "high" : "medium",
      values: { count: stats.unanswered, negative: stats.unansweredNegative },
    },
    {
      key: "reviews-response-rate",
      ok:
        stats.responseRate === null
          ? null
          : stats.responseRate >= RESPONSE_RATE_TARGET * 100,
      severity: "medium",
      values: {
        rate: stats.responseRate ?? 0,
        target: RESPONSE_RATE_TARGET * 100,
      },
    },
  ];
}

/** Summary of the reviews read: rating, pace, distribution, replies. */
export const reviewsSummaryAnalysis: LocationAnalysis = {
  key: "reviews-summary",
  area: "reviews",
  phase: "blocking",
  labelKey: "googleBusiness.analyses.reviews-summary",
  usesAi: false,
  async run({ snapshot, reviews }) {
    const stats = reviewStats(snapshot, reviews);
    return checklistResult("reviews", reviewsChecklist(stats), {
      rating: stats.rating,
      reviewCount: stats.reviewCount,
      reviewsRead: stats.read,
      responseRate: stats.responseRate,
      unanswered: stats.unanswered,
      unansweredNegative: stats.unansweredNegative,
      last30Days: stats.last30Days,
      stars1: stats.distribution[1],
      stars2: stats.distribution[2],
      stars3: stats.distribution[3],
      stars4: stats.distribution[4],
      stars5: stats.distribution[5],
    });
  },
};
