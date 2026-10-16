/**
 * Plan quotas and cost of the map (GB1b, especificação §6.2 "Custo e
 * cotas"). The three keys are declared in the module manifest, so they show
 * in the CF4 catalog (Planos e limites) with the platform ceiling of each.
 * On top of the plan and the ceiling, the code keeps a hard cap.
 *
 * - keywords: active keywords per unit;
 * - grid size: points per side of the grid (5 = 5×5);
 * - scans per month: measurements per unit per calendar month. The
 *   starting point of the onboarding does not count.
 */

export const MapsQuotas = {
  KEYWORDS: "google-business.maps-keywords",
  GRID_SIZE: "google-business.maps-grid-size",
  SCANS_PER_MONTH: "google-business.maps-scans-per-month",
} as const;

/** Defaults when the plan sets nothing (manifest defaults). */
export const MAPS_QUOTA_DEFAULTS = {
  keywords: 3,
  gridSize: 7,
  scansPerMonth: 1,
} as const;

/** Hard caps of the code, above any plan or ceiling. */
export const MAPS_PLATFORM_CAPS = {
  keywords: 10,
  gridSize: 9,
  scansPerMonth: 4,
} as const;

/** The grid of the specification: 7×7 with a 5 km radius. */
export const DEFAULT_GRID_SIZE = 7;
export const DEFAULT_RADIUS_KM = 5;

/**
 * Size of the grid allowed by the plan: the default 7, never above the plan
 * value or the hard cap, odd and at least 3.
 */
export function effectiveGridSize(planLimit: number | null): number {
  const limit = Math.min(
    DEFAULT_GRID_SIZE,
    planLimit ?? DEFAULT_GRID_SIZE,
    MAPS_PLATFORM_CAPS.gridSize,
  );
  const odd = limit % 2 === 1 ? limit : limit - 1;
  return Math.max(3, odd);
}

export function effectiveKeywordLimit(planLimit: number | null): number {
  return Math.max(
    0,
    Math.min(
      planLimit ?? MAPS_PLATFORM_CAPS.keywords,
      MAPS_PLATFORM_CAPS.keywords,
    ),
  );
}

export function effectiveScanLimit(planLimit: number | null): number {
  return Math.max(
    0,
    Math.min(
      planLimit ?? MAPS_PLATFORM_CAPS.scansPerMonth,
      MAPS_PLATFORM_CAPS.scansPerMonth,
    ),
  );
}

/**
 * Prices of the DataForSEO standard queue in US$ millionths per task
 * (public price list as quoted by `AgriciDaniel/claude-seo`, MIT,
 * `skills/seo/references/maps-api-endpoints.md`, September 2026). To be
 * confirmed with the GUIDU account; the estimate is recorded per scan.
 */
export const DATAFORSEO_COST_MICROS = {
  /** Google Maps SERP, standard queue, per task (one grid point). */
  mapsTask: 600,
  /** My Business Info, standard queue, per profile. */
  profile: 1500,
  /** Reviews by place id, per 20 reviews. */
  reviewsPer20: 750,
} as const;

export type CostEstimate = Readonly<{
  apiCalls: number;
  /** US$ millionths. */
  micros: number;
}>;

export function estimateScanCost(
  input: Readonly<{
    gridSize: number;
    keywords: number;
    profileCalls?: number;
    reviewsFetched?: number;
  }>,
): CostEstimate {
  const mapsTasks = input.gridSize * input.gridSize * input.keywords;
  const profileCalls = input.profileCalls ?? 0;
  const reviewCalls = Math.ceil((input.reviewsFetched ?? 0) / 20);
  return {
    apiCalls: mapsTasks + profileCalls + reviewCalls,
    micros:
      mapsTasks * DATAFORSEO_COST_MICROS.mapsTask +
      profileCalls * DATAFORSEO_COST_MICROS.profile +
      reviewCalls * DATAFORSEO_COST_MICROS.reviewsPer20,
  };
}

/** First instant of the calendar month of `now` (UTC). */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
