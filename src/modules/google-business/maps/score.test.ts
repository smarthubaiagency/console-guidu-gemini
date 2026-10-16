import { describe, expect, it } from "vitest";

import type { LocationSnapshot } from "../analyses/contract";
import type { ReviewStats } from "./reviews";
import {
  computeHealthScore,
  profileItems,
  SCORE_WEIGHTS,
  weakestDimension,
} from "./score";

const SNAPSHOT: LocationSnapshot = {
  provider: "fake",
  externalId: "x",
  placeId: "p1",
  name: "Clínica Sorriso",
  primaryCategory: "Dentista",
  additionalCategories: [],
  description: "Curta.",
  phone: "+55 11 3000-0000",
  website: null,
  address: {
    lines: ["Rua A, 1"],
    locality: "São Paulo",
    administrativeArea: "SP",
    postalCode: null,
    countryCode: "BR",
  },
  latitude: -23.5,
  longitude: -46.6,
  timeZone: "America/Sao_Paulo",
  regularHours: [{ day: 1, open: "08:00", close: "18:00" }],
  specialHours: [],
  rating: 4.2,
  reviewCount: 30,
  photoCount: 4,
  attributes: {},
  readAt: "2026-10-16T12:00:00.000Z",
};

function stats(overrides: Partial<ReviewStats> = {}): ReviewStats {
  return {
    rating: 4.2,
    reviewCount: 30,
    monthly: [],
    monthlyAverage: 1,
    daysSinceLast: 10,
    longestGapDays: 20,
    distribution: { "1": 0, "2": 1, "3": 2, "4": 7, "5": 20 },
    responseRate: 50,
    unanswered: 15,
    competitorMedianRating: 4.6,
    competitorMedianReviews: 120,
    competitorCount: 10,
    burstDays: 0,
    ...overrides,
  };
}

describe("Saúde no Maps 0–100 with the math in view (GB1b)", () => {
  it("adds the four dimensions and shows the inputs of each", () => {
    const score = computeHealthScore({
      visibility: [60, 30],
      solv: [50, 20],
      reviews: stats(),
      snapshot: SNAPSHOT,
    });
    const byKey = Object.fromEntries(score.breakdown.map((d) => [d.key, d]));
    // Visibility: mean 45% of 35.
    expect(byKey.visibility).toMatchObject({
      points: 15.8,
      max: 35,
      inputs: { visibility: 45, solv: 35, keywords: 2 },
    });
    // Reviews: rating 4.2 vs 4.6 → 0.6 × 12.5; 30 of 120 → 0.25 × 12.5.
    expect(byKey.reviews).toMatchObject({
      points: 10.6,
      max: 25,
      inputs: { rating: 4.2, ratingReference: 4.6, reviewCount: 30, countReference: 120, reference: "competitors" },
    });
    // Activity: 1 of 2 per month → 5; 50% replied → 5.
    expect(byKey.activity).toMatchObject({ points: 10, max: 20 });
    // Profile: category, phone, hours, address = 4 of 8.
    expect(byKey.profile).toMatchObject({ points: 10, max: 20, inputs: { done: 4, total: 8 } });
    expect(score.score).toBe(Math.round(15.8 + 10.6 + 10 + 10));
    expect(score.breakdown.reduce((sum, d) => sum + d.max, 0)).toBe(100);
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("uses fixed references when there are no competitors", () => {
    const score = computeHealthScore({
      visibility: [100],
      solv: [100],
      reviews: stats({
        competitorMedianRating: null,
        competitorMedianReviews: null,
        rating: 4.8,
        reviewCount: 12,
        monthlyAverage: 3,
        responseRate: 100,
      }),
      snapshot: {
        ...SNAPSHOT,
        description: "x".repeat(300),
        additionalCategories: ["Clínica odontológica"],
        website: "https://example.com",
        photoCount: 20,
      },
    });
    expect(score.score).toBe(100);
    expect(score.breakdown.find((d) => d.key === "reviews")?.inputs.reference).toBe("fixed");
    expect(weakestDimension(score)).toBeNull();
  });

  it("never goes below zero and names the weakest dimension", () => {
    const score = computeHealthScore({
      visibility: [],
      solv: [],
      reviews: stats({ rating: null, reviewCount: 0, monthlyAverage: 0, responseRate: null }),
      snapshot: { ...SNAPSHOT, primaryCategory: null, phone: null, regularHours: [], address: null },
    });
    expect(score.score).toBe(0);
    expect(weakestDimension(score)?.key).toBe("visibility");
  });

  it("checks the eight profile items", () => {
    expect(profileItems(SNAPSHOT)).toEqual({
      description: false,
      primaryCategory: true,
      additionalCategories: false,
      phone: true,
      website: false,
      hours: true,
      photos: false,
      address: true,
    });
  });
});
