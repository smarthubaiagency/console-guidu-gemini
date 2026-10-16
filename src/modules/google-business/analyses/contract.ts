/**
 * Shared contract of the location analyses (GB1a and GB1b, built in
 * parallel). GB1a owns the onboarding, the persistence of the results and the
 * automation page; GB1b owns the intelligence analyses (AI suggestions, maps).
 * Changing this file needs both sides: see
 * docs/modules/google-business/contrato-analises.md.
 */
import type { RequestContext } from "@/lib/prisma/with-context";

/** Areas of the automation page, in display order. */
export const ANALYSIS_AREAS = [
  "info",
  "hours",
  "reviews",
  "posts",
  "photos",
  "services",
  "defense",
  "maps",
] as const;
export type AnalysisArea = (typeof ANALYSIS_AREAS)[number];

export type LocationProvider = "zernio" | "google" | "fake";

export type LocationAddress = Readonly<{
  lines: readonly string[];
  locality: string | null;
  administrativeArea: string | null;
  postalCode: string | null;
  countryCode: string;
}>;

/** Weekday 0 = Sunday … 6 = Saturday; times as "HH:MM" in the unit time zone. */
export type RegularHours = Readonly<{
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  open: string;
  close: string;
}>;

export type SpecialHours = Readonly<{
  /** ISO date (YYYY-MM-DD). */
  date: string;
  closed: boolean;
  open: string | null;
  close: string | null;
}>;

/** What the provider returned when the location was read. */
export type LocationSnapshot = Readonly<{
  provider: LocationProvider;
  /** Provider id of the location (Zernio account/location, Google name). */
  externalId: string;
  placeId: string | null;
  name: string;
  primaryCategory: string | null;
  additionalCategories: readonly string[];
  description: string | null;
  phone: string | null;
  website: string | null;
  address: LocationAddress | null;
  latitude: number | null;
  longitude: number | null;
  timeZone: string | null;
  regularHours: readonly RegularHours[];
  specialHours: readonly SpecialHours[];
  rating: number | null;
  reviewCount: number;
  photoCount: number;
  attributes: Readonly<Record<string, unknown>>;
  /** ISO timestamp of the read. */
  readAt: string;
}>;

/** Public review data only (what Google shows to anyone). */
export type ReviewSummary = Readonly<{
  externalId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string | null;
  authorName: string | null;
  createdAt: string;
  replied: boolean;
  replyText: string | null;
}>;

export type AnalysisStatus =
  "pending" | "running" | "done" | "failed" | "skipped";

export type FindingSeverity = "critical" | "high" | "medium" | "low";

/** One point to validate on the automation page. */
export type AnalysisFinding = Readonly<{
  /** Stable within the analysis (for example "description-short"). */
  key: string;
  area: AnalysisArea;
  severity: FindingSeverity;
  /** i18n message key and values, never free text in a fixed language. */
  titleKey: string;
  detailKey: string;
  values?: Readonly<Record<string, string | number>>;
  /** Current and suggested values when the finding proposes a change. */
  current?: string | null;
  suggested?: string | null;
  source: "deterministic" | "ai" | "maps";
}>;

export type AnalysisResult = Readonly<{
  status: Exclude<AnalysisStatus, "pending" | "running">;
  findings: readonly AnalysisFinding[];
  /** Numbers shown in the area (for example soLV, responseRate). */
  metrics?: Readonly<Record<string, number | null>>;
  /** English, for logs only; the page shows a generic message. */
  error?: string;
}>;

export type AnalysisContext = Readonly<{
  /** Workspace context of whoever started the onboarding (RLS). */
  request: RequestContext;
  /** gb location (GB1a table) and the unit (workspace_locations.id). */
  locationId: string;
  unitId: string;
  snapshot: LocationSnapshot;
  reviews: readonly ReviewSummary[];
}>;

/**
 * "blocking" analyses finish before the onboarding window closes;
 * "background" ones keep running and the page shows the area as running
 * until the result arrives.
 */
export type AnalysisPhase = "blocking" | "background";

export type LocationAnalysis = Readonly<{
  /** Unique, kebab-case (for example "maps-geo-grid"). */
  key: string;
  area: AnalysisArea;
  phase: AnalysisPhase;
  /** i18n key of the step label shown in the onboarding window. */
  labelKey: string;
  /** Uses the platform AI key (our cost), never the customer's. */
  usesAi: boolean;
  run(context: AnalysisContext): Promise<AnalysisResult>;
}>;
