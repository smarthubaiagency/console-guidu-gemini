import { describe, expect, it } from "vitest";

import {
  computeAverageRank,
  computeSolv,
  computeVisibility,
  directionOf,
  gridMetrics,
  weakestDirection,
} from "./metrics";

// 3×3: top 3 at 4 points, 4–10 at 2, 11–20 at 1, not found at 2.
const RANKS = [
  [1, 2, 12],
  [3, 1, 5],
  [null, 9, null],
];

describe("SoLV, average position and visibility (GB1b)", () => {
  it("computes SoLV as top-3 points over all points", () => {
    expect(computeSolv(RANKS)).toBe(44.44);
    expect(
      computeSolv([
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ]),
    ).toBe(100);
    expect(
      computeSolv([
        [null, null, null],
        [null, 30, null],
        [null, null, null],
      ]),
    ).toBe(0);
  });

  it("averages the position where the unit shows up", () => {
    // (1 + 2 + 12 + 3 + 1 + 5 + 9) / 7
    expect(computeAverageRank(RANKS)).toBe(4.71);
    expect(computeAverageRank([[null]])).toBeNull();
  });

  it("weights the visibility: top 3 = 3, 4–10 = 1, the rest 0", () => {
    // (4 × 3 + 2 × 1) / (3 × 9) × 100
    expect(computeVisibility(RANKS)).toBe(51.85);
  });

  it("treats positions outside 1–20 as not found", () => {
    expect(
      gridMetrics([
        [0, 21, 3],
        [2, 1, 1],
        [1, 1, 1],
      ]),
    ).toMatchObject({
      totalPoints: 9,
      foundPoints: 7,
      top3Points: 7,
    });
  });

  it("finds the compass sector with the worst positions", () => {
    expect(directionOf(1, 1, 3)).toBeNull();
    expect(directionOf(0, 1, 3)).toBe("n");
    expect(directionOf(1, 2, 3)).toBe("e");
    expect(directionOf(2, 0, 3)).toBe("sw");
    expect(directionOf(0, 2, 3)).toBe("ne");
    // East column not found, the rest in the top 3.
    expect(
      weakestDirection([
        [1, 1, 3],
        [1, 1, null],
        [1, 2, 2],
      ]),
    ).toBe("e");
    expect(
      weakestDirection([
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ]),
    ).toBeNull();
  });

  it("returns every number at once", () => {
    expect(gridMetrics(RANKS)).toEqual({
      totalPoints: 9,
      foundPoints: 7,
      top3Points: 4,
      solv: 44.44,
      averageRank: 4.71,
      visibility: 51.85,
      weakestDirection: "sw",
    });
  });
});
