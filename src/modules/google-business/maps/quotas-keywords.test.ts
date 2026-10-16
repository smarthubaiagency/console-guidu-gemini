import { describe, expect, it } from "vitest";

import {
  categoryAsKeyword,
  languageOfCountry,
  normalizeKeyword,
  suggestKeywords,
} from "./keywords";
import {
  effectiveGridSize,
  effectiveKeywordLimit,
  effectiveScanLimit,
  estimateScanCost,
  MAPS_PLATFORM_CAPS,
  monthStart,
} from "./quotas";

describe("plan quotas of the map (GB1b)", () => {
  it("keeps the grid at 7×7 unless the plan allows less, odd and at least 3", () => {
    expect(effectiveGridSize(null)).toBe(7);
    expect(effectiveGridSize(9)).toBe(7);
    expect(effectiveGridSize(5)).toBe(5);
    expect(effectiveGridSize(6)).toBe(5);
    expect(effectiveGridSize(1)).toBe(3);
    expect(effectiveGridSize(0)).toBe(3);
  });

  it("caps keywords and measurements with the platform ceiling of the code", () => {
    expect(effectiveKeywordLimit(3)).toBe(3);
    expect(effectiveKeywordLimit(null)).toBe(MAPS_PLATFORM_CAPS.keywords);
    expect(effectiveKeywordLimit(1000)).toBe(MAPS_PLATFORM_CAPS.keywords);
    expect(effectiveScanLimit(2)).toBe(2);
    expect(effectiveScanLimit(null)).toBe(MAPS_PLATFORM_CAPS.scansPerMonth);
    expect(effectiveScanLimit(0)).toBe(0);
  });

  it("estimates the cost of a measurement in the DataForSEO standard queue", () => {
    // 7 × 7 × 3 keywords = 147 tasks at US$ 0.0006.
    expect(estimateScanCost({ gridSize: 7, keywords: 3 })).toEqual({
      apiCalls: 147,
      micros: 88_200,
    });
    // Plus one profile (US$ 0.0015) and 60 reviews (3 × US$ 0.00075).
    expect(
      estimateScanCost({
        gridSize: 7,
        keywords: 1,
        profileCalls: 1,
        reviewsFetched: 60,
      }),
    ).toEqual({ apiCalls: 49 + 1 + 3, micros: 49 * 600 + 1500 + 3 * 750 });
  });

  it("counts the month from its first day (UTC)", () => {
    expect(monthStart(new Date("2026-10-16T12:00:00Z")).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });
});

describe("keywords the agent picks (GB1b)", () => {
  it("turns categories into searches", () => {
    expect(categoryAsKeyword("gcid:dental_clinic")).toBe("dental clinic");
    expect(categoryAsKeyword("Dentista")).toBe("dentista");
    expect(categoryAsKeyword(" ")).toBeNull();
    expect(categoryAsKeyword(null)).toBeNull();
    expect(normalizeKeyword("  Dentista   Centro ")).toBe("dentista centro");
  });

  it("picks three from the category, the near-me intent and the rest", () => {
    expect(
      suggestKeywords({
        primaryCategory: "Dentista",
        additionalCategories: ["Clínica odontológica", "Dentista"],
        locality: "Campinas",
        language: "pt",
      }),
    ).toEqual(["dentista", "dentista perto de mim", "clínica odontológica"]);
    expect(
      suggestKeywords({
        primaryCategory: "gcid:bakery",
        additionalCategories: [],
        locality: "Austin",
        language: "en",
      }),
    ).toEqual(["bakery", "bakery near me", "bakery austin"]);
    expect(
      suggestKeywords({
        primaryCategory: null,
        additionalCategories: [],
        locality: "Madrid",
        language: "es",
      }),
    ).toEqual([]);
  });

  it("chooses the language of the searches from the country", () => {
    expect(languageOfCountry("BR")).toBe("pt");
    expect(languageOfCountry(null)).toBe("pt");
    expect(languageOfCountry("mx")).toBe("es");
    expect(languageOfCountry("US")).toBe("en");
  });
});
