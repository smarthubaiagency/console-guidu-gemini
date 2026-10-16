import { describe, expect, it } from "vitest";

import type { ReviewSummary } from "../analyses/contract";
import { median, reviewStats } from "./reviews";

const NOW = new Date("2026-10-16T12:00:00Z");

function review(daysAgo: number, rating: ReviewSummary["rating"], replied: boolean): ReviewSummary {
  return {
    externalId: `r-${daysAgo}-${rating}`,
    rating,
    text: null,
    authorName: null,
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    replied,
    replyText: null,
  };
}

describe("review intelligence (GB1b)", () => {
  it("counts six months, gaps, stars and replies", () => {
    const reviews = [
      review(2, 5, true),
      review(10, 4, false),
      review(40, 5, true),
      review(100, 1, false),
      review(300, 5, true), // outside the window
    ];
    const stats = reviewStats({
      reviews,
      rating: 4.4,
      reviewCount: 80,
      competitors: [
        { rating: 4.8, reviews: 200 },
        { rating: 4.2, reviews: 40 },
        { rating: null, reviews: null },
        { rating: 4.6, reviews: 100 },
      ],
      now: NOW,
    });
    expect(stats.monthly.map((m) => m.month)).toEqual([
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(stats.monthly.map((m) => m.count)).toEqual([0, 0, 1, 0, 1, 2]);
    expect(stats.monthlyAverage).toBe(0.7);
    expect(stats.daysSinceLast).toBe(2);
    // From 1 May to the review of 8 July (100 days ago) is the longest stretch.
    expect(stats.longestGapDays).toBe(68);
    expect(stats.distribution).toEqual({ "1": 1, "2": 0, "3": 0, "4": 1, "5": 3 });
    expect(stats.responseRate).toBe(60);
    expect(stats.unanswered).toBe(2);
    expect(stats.competitorMedianRating).toBe(4.6);
    expect(stats.competitorMedianReviews).toBe(100);
    expect(stats.competitorCount).toBe(4);
    expect(stats.burstDays).toBe(0);
  });

  it("flags days with three or more five-star reviews", () => {
    const stats = reviewStats({
      reviews: [review(3, 5, true), review(3, 5, true), review(3, 5, true), review(9, 5, true)],
      rating: 5,
      reviewCount: 4,
      competitors: [],
      now: NOW,
    });
    expect(stats.burstDays).toBe(1);
    expect(stats.competitorMedianRating).toBeNull();
  });

  it("handles a unit without reviews", () => {
    const stats = reviewStats({ reviews: [], rating: null, reviewCount: 0, competitors: [], now: NOW });
    expect(stats).toMatchObject({
      monthlyAverage: 0,
      daysSinceLast: null,
      longestGapDays: null,
      responseRate: null,
      unanswered: 0,
    });
  });

  it("takes the median of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
