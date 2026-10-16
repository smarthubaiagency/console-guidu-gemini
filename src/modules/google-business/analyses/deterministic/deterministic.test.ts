import { describe, expect, it, vi } from "vitest";

// The registry also loads the intelligence analyses (server-only, GB1b).
vi.mock("server-only", () => ({}));

import type { LocationSnapshot, ReviewSummary } from "../contract";
import { locationAnalyses } from "../registry";
import { deterministicAnalyses } from ".";
import { easterSunday, nationalHolidays, upcomingHolidays } from "./holidays";
import { hoursChecklist } from "./hours";
import { infoChecklist } from "./info";
import { photosChecklist } from "./photos";
import { reviewStats, reviewsChecklist } from "./reviews";

function snapshot(over: Partial<LocationSnapshot> = {}): LocationSnapshot {
  return {
    provider: "fake",
    externalId: "x",
    placeId: null,
    name: "Loja",
    primaryCategory: "Padaria",
    additionalCategories: ["Café"],
    description: "a".repeat(300),
    phone: "+5511999990000",
    website: "https://loja.example.com",
    address: null,
    latitude: null,
    longitude: null,
    timeZone: "America/Sao_Paulo",
    regularHours: [{ day: 1, open: "08:00", close: "18:00" }],
    specialHours: [],
    rating: 4.5,
    reviewCount: 10,
    photoCount: 20,
    attributes: { delivery: true, "_media.logo": true, "_media.cover": true },
    readAt: "2026-03-01T12:00:00.000Z",
    ...over,
  };
}

function review(over: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    externalId: "r",
    rating: 5,
    text: null,
    authorName: null,
    createdAt: "2026-02-25T12:00:00.000Z",
    replied: true,
    replyText: "Obrigado",
    ...over,
  };
}

const failed = (items: { key: string; ok: boolean | null }[]) =>
  items.filter((i) => i.ok === false).map((i) => i.key);

describe("national holidays", () => {
  it("computes Easter and the movable holidays", () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    const dates = new Map(nationalHolidays(2026).map((h) => [h.key, h.date]));
    expect(dates.get("carnival_tuesday")).toBe("2026-02-17");
    expect(dates.get("good_friday")).toBe("2026-04-03");
    expect(dates.get("corpus_christi")).toBe("2026-06-04");
    expect(dates.get("black_consciousness")).toBe("2026-11-20");
  });

  it("crosses the year for the look-ahead", () => {
    expect(upcomingHolidays("2026-12-20", 15).map((h) => h.key)).toEqual([
      "christmas",
      "new_year",
    ]);
  });
});

describe("deterministic checklist", () => {
  it("finds nothing on a complete ficha", () => {
    expect(failed(infoChecklist(snapshot()))).toEqual([]);
    expect(failed(photosChecklist(snapshot()))).toEqual([]);
  });

  it("reports what the ficha lacks", () => {
    const items = infoChecklist(
      snapshot({
        primaryCategory: null,
        additionalCategories: [],
        description: "Veja www.loja.com",
        phone: null,
        website: null,
        attributes: {},
      }),
    );
    expect(failed(items)).toEqual([
      "primary-category",
      "additional-categories",
      "description-short",
      "description-link",
      "phone-missing",
      "website-missing",
      "attributes-missing",
    ]);
    // A missing description is judged once, not as short and with link.
    expect(failed(infoChecklist(snapshot({ description: null })))).toEqual([
      "description-missing",
    ]);
  });

  it("warns about a holiday without special hours, urgent within 14 days", () => {
    const near = hoursChecklist(snapshot({ readAt: "2026-12-15T12:00:00Z" }));
    const holidays = near.find((i) => i.key === "holidays-missing");
    expect(holidays).toMatchObject({
      ok: false,
      severity: "high",
      values: { count: 2, date: "2026-12-25", days: 10 },
    });
    const covered = hoursChecklist(
      snapshot({
        readAt: "2026-12-15T12:00:00Z",
        specialHours: [
          { date: "2026-12-25", closed: true, open: null, close: null },
          { date: "2027-01-01", closed: true, open: null, close: null },
        ],
      }),
    );
    expect(failed(covered)).toEqual([]);
  });

  it("leaves out what the provider does not report", () => {
    const items = photosChecklist(
      snapshot({
        photoCount: 0,
        attributes: { "_media.photos_unknown": true },
      }),
    );
    expect(items.every((i) => i.ok === null)).toBe(true);
  });

  it("summarizes the reviews and the response rate", () => {
    const stats = reviewStats(snapshot(), [
      review(),
      review({ rating: 1, replied: false, replyText: null }),
      review({
        rating: 4,
        replied: false,
        replyText: null,
        createdAt: "2025-12-01T00:00:00Z",
      }),
    ]);
    expect(stats).toMatchObject({
      unanswered: 2,
      unansweredNegative: 1,
      responseRate: 33,
      last30Days: 2,
    });
    const items = reviewsChecklist(stats);
    expect(items.find((i) => i.key === "reviews-unanswered")?.severity).toBe(
      "high",
    );
    expect(failed(items)).toEqual([
      "reviews-unanswered",
      "reviews-response-rate",
    ]);
  });
});

describe("registry of the contract", () => {
  it("runs the deterministic analyses in the blocking phase, without AI", async () => {
    expect(
      deterministicAnalyses.every((a) => a.phase === "blocking" && !a.usesAi),
    ).toBe(true);
    for (const analysis of deterministicAnalyses) {
      expect(locationAnalyses).toContain(analysis);
      const result = await analysis.run({
        request: { userId: "u", workspaceId: "w", organizationId: "o" },
        locationId: "l",
        unitId: "u",
        snapshot: snapshot(),
        reviews: [review()],
      });
      expect(result.status).toBe("done");
      expect(result.metrics?.itemsTotal).toBeGreaterThan(0);
      for (const finding of result.findings) {
        expect(finding.titleKey).toMatch(/^googleBusiness\.findings\./);
      }
    }
    expect(new Set(locationAnalyses.map((a) => a.key)).size).toBe(
      locationAnalyses.length,
    );
  });
});
