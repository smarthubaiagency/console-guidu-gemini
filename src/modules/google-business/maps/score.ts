import type { LocationSnapshot } from "../analyses/contract";

import type { ReviewStats } from "./reviews";

/**
 * Saúde no Maps, 0 to 100 (GB1b, especificação §6.2), always with the math
 * in view: four dimensions, each with its points, its maximum and the
 * numbers that produced it. Separate from the checklist diagnosis (§6.1).
 *
 * The dimensions follow the "Maps Health Score with dimension breakdown" of
 * `AgriciDaniel/claude-seo` (MIT, `skills/seo-maps/SKILL.md`), with weights
 * and references chosen by GUIDU (to be confirmed by Marcelo):
 *
 * | Dimension   | Max | Math                                                      |
 * | ----------- | --- | --------------------------------------------------------- |
 * | visibility  | 35  | mean visibility of the keywords (top 3 = 3, 4–10 = 1) × 35 |
 * | reviews     | 25  | rating vs competitors' median (12.5) + count vs median (12.5) |
 * | activity    | 20  | monthly pace vs reference (10) + response rate (10)        |
 * | profile     | 20  | 8 profile items × 2.5                                      |
 *
 * Without competitors, the reviews dimension compares with fixed
 * references (rating 4.5, 10 reviews), marked as such in the inputs.
 */

export const SCORE_WEIGHTS = {
  visibility: 35,
  reviews: 25,
  activity: 20,
  profile: 20,
} as const;

export type ScoreDimensionKey = keyof typeof SCORE_WEIGHTS;

/** References used when there is nothing to compare with. */
export const SCORE_REFERENCES = {
  /** Rating considered full marks without competitors. */
  rating: 4.5,
  /** Reviews considered full marks without competitors. */
  reviewCount: 10,
  /** Reviews per month considered full marks for the pace. */
  monthlyPace: 2,
  /** Description length considered complete (Google allows 750). */
  descriptionMin: 250,
  /** Photos considered complete. */
  photos: 10,
} as const;

export type ScoreDimension = Readonly<{
  key: ScoreDimensionKey;
  /** One decimal. */
  points: number;
  max: number;
  /** Numbers behind the points, shown next to them. */
  inputs: Readonly<Record<string, number | string | boolean | null>>;
}>;

export type HealthScore = Readonly<{
  score: number;
  breakdown: readonly ScoreDimension[];
}>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

export const PROFILE_ITEMS = [
  "description",
  "primaryCategory",
  "additionalCategories",
  "phone",
  "website",
  "hours",
  "photos",
  "address",
] as const;

export type ProfileItem = (typeof PROFILE_ITEMS)[number];

export function profileItems(
  snapshot: LocationSnapshot,
): Record<ProfileItem, boolean> {
  const description = snapshot.description?.trim() ?? "";
  return {
    description: description.length >= SCORE_REFERENCES.descriptionMin,
    primaryCategory: Boolean(snapshot.primaryCategory),
    additionalCategories: snapshot.additionalCategories.length > 0,
    phone: Boolean(snapshot.phone),
    website: Boolean(snapshot.website),
    hours: snapshot.regularHours.length > 0,
    photos: snapshot.photoCount >= SCORE_REFERENCES.photos,
    address: snapshot.address !== null,
  };
}

export function computeHealthScore(
  input: Readonly<{
    /** Visibility (0–100) of each keyword of the measurement. */
    visibility: readonly number[];
    solv: readonly number[];
    reviews: ReviewStats;
    snapshot: LocationSnapshot;
  }>,
): HealthScore {
  const { reviews, snapshot } = input;

  const meanVisibility =
    input.visibility.length > 0
      ? input.visibility.reduce((sum, v) => sum + v, 0) /
        input.visibility.length
      : 0;
  const meanSolv =
    input.solv.length > 0
      ? input.solv.reduce((sum, v) => sum + v, 0) / input.solv.length
      : 0;
  const visibility: ScoreDimension = {
    key: "visibility",
    max: SCORE_WEIGHTS.visibility,
    points: round1((meanVisibility / 100) * SCORE_WEIGHTS.visibility),
    inputs: {
      visibility: round1(meanVisibility),
      solv: round1(meanSolv),
      keywords: input.visibility.length,
    },
  };

  const half = SCORE_WEIGHTS.reviews / 2;
  const compared = reviews.competitorMedianRating !== null;
  const ratingReference =
    reviews.competitorMedianRating ?? SCORE_REFERENCES.rating;
  const countReference = Math.max(
    1,
    reviews.competitorMedianReviews ?? SCORE_REFERENCES.reviewCount,
  );
  // One star below the reference is zero; at or above it, full marks.
  const ratingShare =
    reviews.rating === null
      ? 0
      : clamp01(reviews.rating - (ratingReference - 1));
  const countShare = clamp01(reviews.reviewCount / countReference);
  const reviewsDimension: ScoreDimension = {
    key: "reviews",
    max: SCORE_WEIGHTS.reviews,
    points: round1(ratingShare * half + countShare * half),
    inputs: {
      rating: reviews.rating,
      ratingReference: round1(ratingReference),
      reviewCount: reviews.reviewCount,
      countReference: Math.round(countReference),
      reference: compared ? "competitors" : "fixed",
    },
  };

  const activityHalf = SCORE_WEIGHTS.activity / 2;
  const paceShare = clamp01(
    reviews.monthlyAverage / SCORE_REFERENCES.monthlyPace,
  );
  const responseShare = clamp01((reviews.responseRate ?? 0) / 100);
  const activity: ScoreDimension = {
    key: "activity",
    max: SCORE_WEIGHTS.activity,
    points: round1(paceShare * activityHalf + responseShare * activityHalf),
    inputs: {
      monthlyAverage: reviews.monthlyAverage,
      paceReference: SCORE_REFERENCES.monthlyPace,
      responseRate: reviews.responseRate,
    },
  };

  const items = profileItems(snapshot);
  const done = PROFILE_ITEMS.filter((item) => items[item]).length;
  const profile: ScoreDimension = {
    key: "profile",
    max: SCORE_WEIGHTS.profile,
    points: round1((done / PROFILE_ITEMS.length) * SCORE_WEIGHTS.profile),
    inputs: { done, total: PROFILE_ITEMS.length, ...items },
  };

  const breakdown = [visibility, reviewsDimension, activity, profile];
  const score = Math.round(
    breakdown.reduce((sum, dimension) => sum + dimension.points, 0),
  );
  return { score: Math.min(100, Math.max(0, score)), breakdown };
}

/** The dimension that loses the most points (for the action next to it). */
export function weakestDimension(score: HealthScore): ScoreDimension | null {
  let weakest: ScoreDimension | null = null;
  let lost = 0;
  for (const dimension of score.breakdown) {
    const missing = dimension.max - dimension.points;
    if (missing > lost) {
      lost = missing;
      weakest = dimension;
    }
  }
  return weakest;
}
