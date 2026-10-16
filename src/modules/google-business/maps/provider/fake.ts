import type { ReviewSummary } from "../../analyses/contract";

import type {
  MapsGridSearch,
  MapsIntelligenceProvider,
  MapsPointResult,
  MapsSearchItem,
  PlaceLookup,
  PlaceProfile,
} from "./types";

/**
 * Deterministic maps provider for tests and e2e
 * (`MAPS_INTELLIGENCE_PROVIDER=fake`); production refuses it at startup
 * (src/core/config/env.ts). The same keyword and grid always give the same
 * positions: the unit ranks well near the centre and drops towards the
 * edges, worse to the east, among 24 invented competitors with
 * neighbourhoods, so every part of the analysis has something to show.
 */

export const FAKE_NEIGHBORHOODS = [
  "Centro",
  "Jardim América",
  "Vila Nova",
  "Bela Vista",
  "Santa Cecília",
  "Boa Vista",
] as const;

/** FNV-1a, enough for a stable seed. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function competitor(index: number): MapsSearchItem {
  const seed = hash(`competitor-${index}`);
  return {
    rank: 0,
    placeId: `fake-place-${String(index).padStart(2, "0")}`,
    cid: String(1000 + index),
    name: `Concorrente ${String(index).padStart(2, "0")}`,
    rating: Math.round((3.6 + (seed % 14) / 10) * 10) / 10,
    reviews: 8 + (seed % 340),
    categories: ["fake category"],
    neighborhood: FAKE_NEIGHBORHOODS[seed % FAKE_NEIGHBORHOODS.length]!,
  };
}

const COMPETITORS = Array.from({ length: 24 }, (_, index) =>
  competitor(index + 1),
);

export const FAKE_TARGET_PLACE_ID = "fake-place-target";

export function createFakeMapsProvider(): MapsIntelligenceProvider {
  return {
    id: "fake",
    async searchGrid(request: MapsGridSearch): Promise<MapsPointResult[]> {
      const size = Math.round(Math.sqrt(request.points.length));
      const middle = (size - 1) / 2;
      const keywordSeed = hash(request.keyword);
      return request.points.map((point) => {
        const distance = Math.hypot(point.row - middle, point.column - middle);
        // East is weaker: the unit is pushed down on the right side.
        const eastPenalty =
          point.column > middle ? (point.column - middle) * 2 : 0;
        const wobble = (keywordSeed + point.row * 7 + point.column * 13) % 3;
        const targetRank = Math.round(
          1 + distance * 2.4 + eastPenalty + wobble,
        );
        const offset =
          (keywordSeed + point.row * size + point.column) % COMPETITORS.length;
        const rotated = [
          ...COMPETITORS.slice(offset),
          ...COMPETITORS.slice(0, offset),
        ];
        const items: MapsSearchItem[] = [];
        let next = 0;
        for (let rank = 1; rank <= 20; rank += 1) {
          if (rank === targetRank) {
            items.push({
              rank,
              placeId: request.target.placeId,
              cid: null,
              name: request.target.name,
              rating: 4.6,
              reviews: 57,
              categories: ["fake category"],
              neighborhood: FAKE_NEIGHBORHOODS[0],
            });
          } else {
            items.push({ ...rotated[next % rotated.length]!, rank });
            next += 1;
          }
        }
        return { row: point.row, column: point.column, items };
      });
    },
    async placeProfile(lookup: PlaceLookup): Promise<PlaceProfile | null> {
      return {
        placeId: lookup.placeId,
        name: "Fake place",
        location: { latitude: -23.5505, longitude: -46.6333 },
        primaryCategory: "dentista",
        additionalCategories: [],
        rating: 4.6,
        reviewCount: 57,
      };
    },
    async placeReviews(
      lookup: PlaceLookup & Readonly<{ depth: number }>,
    ): Promise<ReviewSummary[]> {
      const base = Date.UTC(2026, 9, 1);
      return Array.from({ length: Math.min(lookup.depth, 12) }, (_, index) => ({
        externalId: `fake-review-${index + 1}`,
        rating: (index % 5 === 4 ? 3 : 5) as ReviewSummary["rating"],
        text: null,
        authorName: null,
        createdAt: new Date(base - index * 12 * 86_400_000).toISOString(),
        replied: index % 3 !== 0,
        replyText: null,
      }));
    },
  };
}
