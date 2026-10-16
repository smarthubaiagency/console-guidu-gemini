import type { LocationSnapshot, ReviewSummary } from "../../analyses/contract";
import { analyseKeywordGrid } from "../../maps/competitors";
import { buildGrid } from "../../maps/geo";
import { gridMetrics } from "../../maps/metrics";
import {
  createFakeMapsProvider,
  FAKE_TARGET_PLACE_ID,
} from "../../maps/provider/fake";
import {
  DEFAULT_GRID_SIZE,
  DEFAULT_RADIUS_KM,
  estimateScanCost,
} from "../../maps/quotas";
import { reviewStats } from "../../maps/reviews";
import { computeHealthScore } from "../../maps/score";
import type { MapsHealthView } from "../../maps/view";

/**
 * Sample measurement for the demonstration of the maps component
 * (`/platform/design/maps`) and its tests: the fake provider over a 7×7
 * grid around a made-up dental clinic, computed with the real formulas.
 * Fixed dates, so the page always shows the same thing.
 */

const NOW = new Date("2026-10-16T12:00:00Z");

export const DEMO_SNAPSHOT: LocationSnapshot = {
  provider: "fake",
  externalId: "demo",
  placeId: FAKE_TARGET_PLACE_ID,
  name: "Clínica Sorriso Centro",
  primaryCategory: "Dentista",
  additionalCategories: ["Clínica odontológica"],
  description:
    "Clínica odontológica no Centro, com atendimento de segunda a sábado e equipe de especialistas.",
  phone: "+55 11 3000-0000",
  website: "https://example.com",
  address: {
    lines: ["Rua Exemplo, 100"],
    locality: "São Paulo",
    administrativeArea: "SP",
    postalCode: "01000-000",
    countryCode: "BR",
  },
  latitude: -23.5505,
  longitude: -46.6333,
  timeZone: "America/Sao_Paulo",
  regularHours: [{ day: 1, open: "08:00", close: "18:00" }],
  specialHours: [],
  rating: 4.6,
  reviewCount: 57,
  photoCount: 14,
  attributes: {},
  readAt: NOW.toISOString(),
};

function demoReviews(): ReviewSummary[] {
  return Array.from({ length: 18 }, (_, index) => ({
    externalId: `demo-${index + 1}`,
    rating: (index % 6 === 5
      ? 3
      : index % 9 === 8
        ? 2
        : 5) as ReviewSummary["rating"],
    text: null,
    authorName: null,
    createdAt: new Date(
      NOW.getTime() - (index * 9 + 2) * 86_400_000,
    ).toISOString(),
    replied: index % 4 !== 0,
    replyText: null,
  }));
}

export async function buildDemoMapsView(): Promise<MapsHealthView> {
  const provider = createFakeMapsProvider();
  const keywords = [
    "dentista",
    "dentista perto de mim",
    "clínica odontológica",
  ];
  const center = {
    latitude: DEMO_SNAPSHOT.latitude!,
    longitude: DEMO_SNAPSHOT.longitude!,
  };
  const points = buildGrid(center, DEFAULT_GRID_SIZE, DEFAULT_RADIUS_KM);
  const target = { placeId: DEMO_SNAPSHOT.placeId, name: DEMO_SNAPSHOT.name };
  const results = [];
  for (const keyword of keywords) {
    const searched = await provider.searchGrid({
      keyword,
      points,
      languageCode: "pt",
      target,
    });
    const grid = analyseKeywordGrid(searched, DEFAULT_GRID_SIZE, target);
    results.push({ keyword, grid, metrics: gridMetrics(grid.ranks) });
  }
  const reviews = reviewStats({
    reviews: demoReviews(),
    rating: DEMO_SNAPSHOT.rating,
    reviewCount: DEMO_SNAPSHOT.reviewCount,
    competitors: results[0]!.grid.competitors.slice(0, 10),
    now: NOW,
  });
  const score = computeHealthScore({
    visibility: results.map((r) => r.metrics.visibility),
    solv: results.map((r) => r.metrics.solv),
    reviews,
    snapshot: DEMO_SNAPSHOT,
  });
  const references = new Set(
    results[0]!.grid.competitors.slice(0, 3).map((c) => c.placeId),
  );
  const cost = estimateScanCost({
    gridSize: DEFAULT_GRID_SIZE,
    keywords: keywords.length,
  });
  return {
    scanId: "demo",
    measuredAt: NOW.toISOString(),
    isBaseline: false,
    gridSize: DEFAULT_GRID_SIZE,
    radiusKm: DEFAULT_RADIUS_KM,
    score: score.score,
    breakdown: score.breakdown,
    reviews,
    keywords: results.map(({ keyword, grid, metrics }) => ({
      keyword,
      gridSize: DEFAULT_GRID_SIZE,
      ranks: grid.ranks,
      solv: metrics.solv,
      averageRank: metrics.averageRank,
      foundPoints: metrics.foundPoints,
      totalPoints: metrics.totalPoints,
      competitors: grid.competitors.map((c) => ({
        ...c,
        isReference: references.has(c.placeId),
      })),
      neighborhoods: grid.neighborhoods,
    })),
    baseline: {
      measuredAt: "2026-07-16T12:00:00.000Z",
      score: Math.max(0, score.score - 14),
      solv: 12.24,
    },
    provider: "fake",
    apiCalls: cost.apiCalls,
    costEstimateMicros: cost.micros,
  };
}
