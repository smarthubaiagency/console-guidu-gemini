import type { ReviewSummary } from "../../analyses/contract";
import type { GridPoint, LatLng } from "../geo";

/**
 * Port of the maps intelligence (GB1b, especificação §11). Analyses and
 * screens talk only to this port; the adapters are `dataforseo` (Maps SERP
 * by coordinate, profile and reviews, standard queue with a bounded wait)
 * and `fake` (tests and e2e; production refuses it at startup). Tests never
 * call a real service.
 */

export type MapsProviderId = "dataforseo" | "fake";

export type MapsSearchItem = Readonly<{
  /** Position in the Maps results, 1-based. */
  rank: number;
  placeId: string | null;
  cid: string | null;
  name: string;
  rating: number | null;
  reviews: number | null;
  categories: readonly string[];
  /** Neighbourhood (borough) of the address, when the provider has it. */
  neighborhood: string | null;
}>;

export type MapsGridSearch = Readonly<{
  keyword: string;
  points: readonly GridPoint[];
  /** ISO 639-1 language of the searches. */
  languageCode: string;
  /** The unit, so the fake can place it; real providers ignore it. */
  target: Readonly<{ placeId: string | null; name: string }>;
}>;

export type MapsPointResult = Readonly<{
  row: number;
  column: number;
  items: readonly MapsSearchItem[];
}>;

export type PlaceProfile = Readonly<{
  placeId: string;
  name: string;
  location: LatLng | null;
  primaryCategory: string | null;
  additionalCategories: readonly string[];
  rating: number | null;
  reviewCount: number | null;
}>;

export type PlaceLookup = Readonly<{
  placeId: string;
  languageCode: string;
  countryCode: string | null;
}>;

export interface MapsIntelligenceProvider {
  readonly id: MapsProviderId;
  /** One search per grid point, same order as `points`. */
  searchGrid(request: MapsGridSearch): Promise<MapsPointResult[]>;
  /** Public profile of a place (centre of the grid when the unit has none). */
  placeProfile(lookup: PlaceLookup): Promise<PlaceProfile | null>;
  /** Newest public reviews of a place. */
  placeReviews(
    lookup: PlaceLookup & Readonly<{ depth: number }>,
  ): Promise<ReviewSummary[]>;
}

/** Coordinates of a place from the Google Maps Platform (never stored). */
export interface PlaceLocator {
  locate(placeId: string): Promise<LatLng | null>;
}

export type MapsProviderErrorCode =
  "auth" | "funds" | "rate_limited" | "timeout" | "bad_response" | "network";

/** English message for logs only; never carries credentials. */
export class MapsProviderError extends Error {
  constructor(
    readonly code: MapsProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MapsProviderError";
  }
}
