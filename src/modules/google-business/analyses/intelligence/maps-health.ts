import "server-only";

import { appLog } from "@/lib/telemetry/log";

import type {
  AnalysisContext,
  AnalysisFinding,
  AnalysisResult,
  LocationAnalysis,
  ReviewSummary,
} from "../contract";
import {
  analyseKeywordGrid,
  newCompetitors,
  type Target,
} from "../../maps/competitors";
import { buildGrid, type LatLng } from "../../maps/geo";
import { languageOfCountry, suggestKeywords } from "../../maps/keywords";
import { gridMetrics, type RankMatrix } from "../../maps/metrics";
import { MapsProviderError } from "../../maps/provider/types";
import { estimateScanCost } from "../../maps/quotas";
import { reviewStats } from "../../maps/reviews";
import { computeHealthScore } from "../../maps/score";
import {
  baselineSummary,
  ensureAgentKeywords,
  ensureReferenceCompetitors,
  loadMapsHealthView,
  loadUnit,
  planMapsScan,
  previousCompetitors,
  recentScanId,
  recordMapsScan,
} from "../../maps/service";
import type { MapsHealthView } from "../../maps/view";
import { finding, stepLabel } from "./findings";
import {
  competitorFindings,
  geoGridFindings,
  type KeywordOutcome,
} from "./maps-findings";
import { currentRuntime } from "./runtime";

/**
 * Saúde no Maps of a unit (GB1b, especificação §6.2 and §7), three
 * background analyses of the onboarding that share one run:
 *
 * - `maps-keywords`: the agent picks three keywords from the category
 *   (adjustable later), within the plan quota;
 * - `maps-competitors`: the 20 strongest competitors per keyword and the
 *   review intelligence compared with them;
 * - `maps-geo-grid`: 7×7 grid with a 5 km radius (Haversine), position per
 *   point, SoLV, average position and the 0–100 score with its breakdown.
 *
 * The first measurement of a unit is its starting point (outside the
 * monthly quota). The run is shared in the process, so the three analyses
 * cost one measurement whatever order the runner calls them in; a repeated
 * run within 30 minutes reuses the measurement already recorded. Only
 * reads and suggests: nothing is changed on the profile.
 */

type MapsRun = Readonly<{
  keywords: AnalysisResult;
  competitors: AnalysisResult;
  geoGrid: AnalysisResult;
}>;

const REUSE_MS = 30 * 60 * 1000;
const REVIEW_DEPTH = 60;

const runs = new Map<string, { at: number; promise: Promise<MapsRun> }>();

function sharedRun(context: AnalysisContext): Promise<MapsRun> {
  const now = Date.now();
  for (const [key, entry] of runs) {
    if (now - entry.at > REUSE_MS) runs.delete(key);
  }
  const key = `${context.request.workspaceId}:${context.unitId}:${context.snapshot.readAt}`;
  const existing = runs.get(key);
  if (existing) return existing.promise;
  const promise = runMapsHealth(context);
  runs.set(key, { at: now, promise });
  promise.catch(() => runs.delete(key));
  return promise;
}

function same(result: AnalysisResult): MapsRun {
  return { keywords: result, competitors: result, geoGrid: result };
}

function skippedWith(keywords: AnalysisResult, rest: AnalysisResult): MapsRun {
  return { keywords, competitors: rest, geoGrid: rest };
}

/** Centre of the grid: the profile, the unit, the provider, the Places. */
async function resolveCenter(
  context: AnalysisContext,
  unitCenter: LatLng | null,
  languageCode: string,
): Promise<{ center: LatLng | null; profileCalls: number }> {
  const { snapshot } = context;
  if (snapshot.latitude !== null && snapshot.longitude !== null) {
    return {
      center: { latitude: snapshot.latitude, longitude: snapshot.longitude },
      profileCalls: 0,
    };
  }
  if (unitCenter) return { center: unitCenter, profileCalls: 0 };
  const runtime = currentRuntime();
  if (!snapshot.placeId) return { center: null, profileCalls: 0 };
  const profile = await runtime.maps?.placeProfile({
    placeId: snapshot.placeId,
    languageCode,
    countryCode: snapshot.address?.countryCode ?? null,
  });
  if (profile?.location) return { center: profile.location, profileCalls: 1 };
  const located = (await runtime.locator?.locate(snapshot.placeId)) ?? null;
  return { center: located, profileCalls: 1 };
}

function outcomesFromView(view: MapsHealthView): KeywordOutcome[] {
  return view.keywords.map((keyword) => ({
    keyword: keyword.keyword,
    metrics: gridMetrics(keyword.ranks),
    competitors: keyword.competitors,
    neighborhoods: keyword.neighborhoods,
    newCompetitors: [],
  }));
}

function gridMetricsOf(
  outcomes: readonly KeywordOutcome[],
  extra: Record<string, number | null>,
) {
  const solvs = outcomes.map((o) => o.metrics.solv);
  const ranks = outcomes
    .map((o) => o.metrics.averageRank)
    .filter((rank): rank is number => rank !== null);
  const mean = (values: number[]) =>
    values.length > 0
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) /
        100
      : null;
  return {
    solv: mean(solvs) ?? 0,
    averageRank: mean(ranks),
    visibility: mean(outcomes.map((o) => o.metrics.visibility)) ?? 0,
    keywords: outcomes.length,
    ...extra,
  };
}

/**
 * One measurement for the three analyses. Never throws: a refused
 * permission or a database error becomes a failed result (English error,
 * for the logs only), as the contract expects.
 */
export async function runMapsHealth(
  context: AnalysisContext,
): Promise<MapsRun> {
  try {
    return await measure(context);
  } catch (error) {
    appLog.warn("google_business.maps.failed", {
      code: error instanceof Error ? error.name : "unknown",
    });
    return same({
      status: "failed",
      findings: [],
      error: "The maps analysis could not run",
    });
  }
}

async function measure(context: AnalysisContext): Promise<MapsRun> {
  const runtime = currentRuntime();
  const { request, snapshot, unitId } = context;
  if (!runtime.maps) {
    return same({
      status: "skipped",
      findings: [],
      error: "Maps provider not configured",
    });
  }
  const maps = runtime.maps;
  const now = runtime.now();
  const language = languageOfCountry(snapshot.address?.countryCode);
  const suggestions = suggestKeywords({
    primaryCategory: snapshot.primaryCategory,
    additionalCategories: snapshot.additionalCategories,
    locality: snapshot.address?.locality ?? null,
    language,
  });

  const prepared = await runtime.transaction(request, async (tx) => {
    const unit = await loadUnit(tx, request, unitId);
    const ensured = await ensureAgentKeywords(tx, request, unitId, suggestions);
    const plan = await planMapsScan(tx, request, unitId, now);
    const recent = await recentScanId(
      tx,
      request,
      unitId,
      new Date(now.getTime() - REUSE_MS),
    );
    const view = recent ? await loadMapsHealthView(tx, request, unitId) : null;
    const previous = await previousCompetitors(tx, request, unitId);
    const baseline = await baselineSummary(tx, request, unitId);
    return { unit, ensured, plan, view, previous, baseline };
  });

  const keywordList = prepared.ensured.keywords;
  const keywordsResult: AnalysisResult =
    keywordList.length === 0
      ? {
          status: "done",
          findings: [
            finding({
              key: "keywords-none",
              titleKey: "keywordsNone",
              area: "maps",
              severity: "high",
              source: "maps",
            }),
          ],
          metrics: { keywords: 0 },
        }
      : {
          status: "done",
          findings: [
            finding({
              key: "keywords-chosen",
              titleKey:
                prepared.ensured.created > 0
                  ? "keywordsChosen"
                  : "keywordsKept",
              area: "maps",
              severity: "low",
              source: "maps",
              values: {
                keywords: keywordList.map((k) => k.keyword).join(", "),
                count: keywordList.length,
              },
            }),
          ],
          metrics: {
            keywords: keywordList.length,
            created: prepared.ensured.created,
          },
        };
  if (keywordList.length === 0) {
    return skippedWith(keywordsResult, {
      status: "skipped",
      findings: [],
      error: "No keywords to measure",
    });
  }

  // A measurement of the last 30 minutes (another process ran it, or this
  // is a retry): rebuild the findings from it instead of paying again.
  if (prepared.view) {
    const view = prepared.view;
    const outcomes = outcomesFromView(view);
    const score = { score: view.score ?? 0, breakdown: view.breakdown };
    return {
      keywords: keywordsResult,
      geoGrid: {
        status: "done",
        findings: geoGridFindings({
          outcomes,
          score,
          isBaseline: view.isBaseline,
          baseline: prepared.baseline,
        }),
        metrics: gridMetricsOf(outcomes, {
          score: view.score,
          baseline: view.isBaseline ? 1 : 0,
          reused: 1,
        }),
      },
      competitors: {
        status: "done",
        findings: view.reviews
          ? competitorFindings({ outcomes, reviews: view.reviews })
          : [],
        metrics: {
          competitors: outcomes[0]?.competitors.length ?? 0,
          reused: 1,
        },
      },
    };
  }

  if (!prepared.plan.allowed) {
    const quota: AnalysisResult = {
      status: "skipped",
      findings: [
        finding({
          key: "maps-quota",
          titleKey: "mapsQuota",
          area: "maps",
          severity: "low",
          source: "maps",
          values: {
            used: prepared.plan.monthlyUsed,
            limit: prepared.plan.monthlyLimit,
          },
        }),
      ],
      error: "Monthly maps quota reached",
    };
    return skippedWith(keywordsResult, quota);
  }

  try {
    const languageCode = language;
    const { center, profileCalls } = await resolveCenter(
      context,
      prepared.unit.center,
      languageCode,
    );
    if (!center) {
      return skippedWith(keywordsResult, {
        status: "skipped",
        findings: [
          finding({
            key: "maps-no-coordinates",
            titleKey: "mapsNoCoordinates",
            area: "maps",
            severity: "high",
            source: "maps",
          }),
        ],
        error: "No coordinates for the centre of the grid",
      });
    }
    const { gridSize, radiusKm } = prepared.plan;
    const points = buildGrid(center, gridSize, radiusKm);
    const target: Target = { placeId: snapshot.placeId, name: snapshot.name };

    const outcomes: (KeywordOutcome & {
      keywordId: string;
      ranks: RankMatrix;
    })[] = [];
    for (const keyword of keywordList) {
      const results = await maps.searchGrid({
        keyword: keyword.keyword,
        points,
        languageCode,
        target,
      });
      const grid = analyseKeywordGrid(results, gridSize, target);
      outcomes.push({
        keywordId: keyword.id,
        keyword: keyword.keyword,
        metrics: gridMetrics(grid.ranks),
        competitors: grid.competitors,
        neighborhoods: grid.neighborhoods,
        newCompetitors: prepared.previous.has(keyword.id)
          ? newCompetitors(grid.competitors, prepared.previous.get(keyword.id)!)
          : [],
        ranks: grid.ranks,
      });
    }

    let reviews: readonly ReviewSummary[] = context.reviews;
    let reviewsFetched = 0;
    if (reviews.length === 0 && snapshot.reviewCount > 0 && snapshot.placeId) {
      reviews = await maps.placeReviews({
        placeId: snapshot.placeId,
        languageCode,
        countryCode: snapshot.address?.countryCode ?? null,
        depth: REVIEW_DEPTH,
      });
      reviewsFetched = REVIEW_DEPTH;
    }
    const stats = reviewStats({
      reviews,
      rating: snapshot.rating,
      reviewCount: snapshot.reviewCount,
      competitors: (outcomes[0]?.competitors ?? []).slice(0, 10),
      now,
    });
    const score = computeHealthScore({
      visibility: outcomes.map((o) => o.metrics.visibility),
      solv: outcomes.map((o) => o.metrics.solv),
      reviews: stats,
      snapshot,
    });
    const cost = estimateScanCost({
      gridSize,
      keywords: outcomes.length,
      profileCalls,
      reviewsFetched,
    });

    const recorded = await runtime.transaction(request, async (tx) => {
      const saved = await recordMapsScan(
        tx,
        request,
        {
          unitId,
          isBaseline: prepared.plan.isBaseline,
          gridSize,
          radiusKm,
          score: score.score,
          breakdown: score.breakdown,
          reviews: stats,
          provider: maps.id,
          apiCalls: cost.apiCalls,
          costEstimateMicros: maps.id === "fake" ? 0 : cost.micros,
          keywords: outcomes.map((o) => ({
            keywordId: o.keywordId,
            keyword: o.keyword,
            ranks: o.ranks,
            solv: o.metrics.solv,
            averageRank: o.metrics.averageRank,
            foundPoints: o.metrics.foundPoints,
            totalPoints: o.metrics.totalPoints,
            competitors: o.competitors,
            neighborhoods: o.neighborhoods,
          })),
        },
        now,
      );
      // The strongest five of the radius as reference, adjustable later.
      const strongest = (outcomes[0]?.competitors ?? [])
        .map((c) => c.placeId)
        .filter((id): id is string => Boolean(id))
        .slice(0, 5);
      await ensureReferenceCompetitors(tx, request, unitId, strongest);
      return saved;
    });

    appLog.info("google_business.maps.scan", {
      provider: maps.id,
      keywords: outcomes.length,
      gridSize,
      apiCalls: cost.apiCalls,
      baseline: recorded.isBaseline,
    });

    const competitorList: AnalysisFinding[] = competitorFindings({
      outcomes,
      reviews: stats,
    });
    return {
      keywords: keywordsResult,
      competitors: {
        status: "done",
        findings: competitorList,
        metrics: {
          competitors: outcomes[0]?.competitors.length ?? 0,
          newCompetitors: outcomes.reduce(
            (sum, o) => sum + o.newCompetitors.length,
            0,
          ),
          monthlyAverage: stats.monthlyAverage,
          responseRate: stats.responseRate,
          rating: stats.rating,
          competitorMedianRating: stats.competitorMedianRating,
        },
      },
      geoGrid: {
        status: "done",
        findings: geoGridFindings({
          outcomes,
          score,
          isBaseline: recorded.isBaseline,
          baseline: prepared.baseline,
        }),
        metrics: gridMetricsOf(outcomes, {
          score: score.score,
          gridSize,
          points: points.length,
          baseline: recorded.isBaseline ? 1 : 0,
          apiCalls: cost.apiCalls,
          costMicros: maps.id === "fake" ? 0 : cost.micros,
        }),
      },
    };
  } catch (error) {
    const message =
      error instanceof MapsProviderError
        ? error.message
        : "The maps measurement failed";
    appLog.warn("google_business.maps.failed", {
      code: error instanceof MapsProviderError ? error.code : "unknown",
    });
    return skippedWith(keywordsResult, {
      status: "failed",
      findings: [],
      error: message,
    });
  }
}

export const mapsKeywordsAnalysis: LocationAnalysis = {
  key: "maps-keywords",
  area: "maps",
  phase: "background",
  labelKey: stepLabel("maps-keywords"),
  usesAi: false,
  run: async (context) => (await sharedRun(context)).keywords,
};

export const mapsCompetitorsAnalysis: LocationAnalysis = {
  key: "maps-competitors",
  area: "maps",
  phase: "background",
  labelKey: stepLabel("maps-competitors"),
  usesAi: false,
  run: async (context) => (await sharedRun(context)).competitors,
};

export const mapsGeoGridAnalysis: LocationAnalysis = {
  key: "maps-geo-grid",
  area: "maps",
  phase: "background",
  labelKey: stepLabel("maps-geo-grid"),
  usesAi: false,
  run: async (context) => (await sharedRun(context)).geoGrid,
};
