import type { CompetitorStat } from "./competitors";
import type { RankMatrix } from "./metrics";
import type { ReviewStats } from "./reviews";
import type { ScoreDimension } from "./score";

/**
 * What the maps component shows (GB1b): the latest measurement of a unit,
 * with the starting point next to it. Plain data, safe to send to the
 * browser (no coordinates, no secrets).
 */

export type MapsCompetitorView = CompetitorStat &
  Readonly<{ isReference: boolean }>;

export type MapsKeywordView = Readonly<{
  keyword: string;
  gridSize: number;
  ranks: RankMatrix;
  solv: number;
  averageRank: number | null;
  foundPoints: number;
  totalPoints: number;
  competitors: readonly MapsCompetitorView[];
  neighborhoods: readonly string[];
}>;

export type MapsBaselineView = Readonly<{
  measuredAt: string;
  score: number | null;
  /** Mean SoLV of the keywords of the starting point. */
  solv: number;
}>;

export type MapsHealthView = Readonly<{
  scanId: string;
  measuredAt: string;
  isBaseline: boolean;
  gridSize: number;
  radiusKm: number;
  score: number | null;
  breakdown: readonly ScoreDimension[];
  reviews: ReviewStats | null;
  keywords: readonly MapsKeywordView[];
  baseline: MapsBaselineView | null;
  provider: string;
  apiCalls: number;
  /** US$ millionths. */
  costEstimateMicros: number;
}>;
