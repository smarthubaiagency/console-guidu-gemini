import type { ReviewSummary } from "../analyses/contract";

/**
 * Review intelligence of a unit (GB1b, especificação §6.2): monthly pace
 * over six months, gaps without reviews, star distribution, response rate,
 * comparison with the competitors of the radius and simple signals of
 * suspicious reviews. Workflow adapted from `AgriciDaniel/claude-seo`
 * (MIT, `skills/seo-maps/SKILL.md`, "Review Intelligence"). The thresholds
 * of third parties quoted there (Sterling Sky's "18 days", "magic 10") are
 * market studies, not Google rules, and are not used as rules here.
 */

export type CompetitorReviews = Readonly<{
  rating: number | null;
  reviews: number | null;
}>;

export type MonthCount = Readonly<{ month: string; count: number }>;

export type ReviewStats = Readonly<{
  /** Rating and total shown on the profile (snapshot). */
  rating: number | null;
  reviewCount: number;
  /** The last six calendar months, oldest first, current month last. */
  monthly: readonly MonthCount[];
  /** Mean reviews per month over those six months, one decimal. */
  monthlyAverage: number;
  daysSinceLast: number | null;
  /** Longest stretch without a review in the window (until today). */
  longestGapDays: number | null;
  distribution: Readonly<Record<"1" | "2" | "3" | "4" | "5", number>>;
  /** Share of the reviews read that have an owner reply, 0–100. */
  responseRate: number | null;
  unanswered: number;
  /** Medians of the competitors of the radius (target excluded). */
  competitorMedianRating: number | null;
  competitorMedianReviews: number | null;
  competitorCount: number;
  /** Days with three or more five-star reviews (possible burst). */
  burstDays: number;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;
export const REVIEW_WINDOW_MONTHS = 6;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(value * 100) / 100;
}

export function reviewStats(
  input: Readonly<{
    reviews: readonly ReviewSummary[];
    rating: number | null;
    reviewCount: number;
    competitors: readonly CompetitorReviews[];
    now: Date;
  }>,
): ReviewStats {
  const { reviews, now } = input;
  const dated = reviews
    .map((review) => ({ review, at: new Date(review.createdAt) }))
    .filter(({ at }) => !Number.isNaN(at.getTime()) && at <= now)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // Months of the window: the current one and the five before it.
  const months: string[] = [];
  for (let back = REVIEW_WINDOW_MONTHS - 1; back >= 0; back -= 1) {
    months.push(
      monthKey(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)),
      ),
    );
  }
  const counts = new Map(months.map((month) => [month, 0]));
  for (const { at } of dated) {
    const key = monthKey(at);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const monthly = months.map((month) => ({
    month,
    count: counts.get(month) ?? 0,
  }));
  const inWindow = monthly.reduce((sum, entry) => sum + entry.count, 0);

  const windowStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (REVIEW_WINDOW_MONTHS - 1),
      1,
    ),
  );
  const last = dated.at(-1)?.at ?? null;
  let longestGapDays: number | null = null;
  if (dated.length > 0) {
    let previous = windowStart;
    let longest = 0;
    for (const { at } of dated) {
      if (at < windowStart) continue;
      longest = Math.max(longest, at.getTime() - previous.getTime());
      previous = at;
    }
    longest = Math.max(longest, now.getTime() - previous.getTime());
    longestGapDays = Math.floor(longest / DAY_MS);
  }

  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const review of reviews) {
    distribution[String(review.rating) as keyof typeof distribution] += 1;
  }
  const replied = reviews.filter((review) => review.replied).length;

  const fiveStarDays = new Map<string, number>();
  for (const { review, at } of dated) {
    if (review.rating !== 5) continue;
    const day = at.toISOString().slice(0, 10);
    fiveStarDays.set(day, (fiveStarDays.get(day) ?? 0) + 1);
  }

  const competitorRatings = input.competitors
    .map((c) => c.rating)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const competitorCounts = input.competitors
    .map((c) => c.reviews)
    .filter((v): v is number => typeof v === "number" && v >= 0);

  return {
    rating: input.rating,
    reviewCount: input.reviewCount,
    monthly,
    monthlyAverage: Math.round((inWindow / REVIEW_WINDOW_MONTHS) * 10) / 10,
    daysSinceLast: last
      ? Math.floor((now.getTime() - last.getTime()) / DAY_MS)
      : null,
    longestGapDays,
    distribution,
    responseRate:
      reviews.length > 0
        ? Math.round((replied / reviews.length) * 1000) / 10
        : null,
    unanswered: reviews.length - replied,
    competitorMedianRating: median(competitorRatings),
    competitorMedianReviews: median(competitorCounts),
    competitorCount: input.competitors.length,
    burstDays: [...fiveStarDays.values()].filter((count) => count >= 3).length,
  };
}
