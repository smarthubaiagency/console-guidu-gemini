import { describe, expect, it } from "vitest";

import { AppError } from "@/shared/errors";

import {
  computeSplit,
  formatCents,
  parseReais,
  partnerPaysShares,
} from "./split";

describe("computeSplit", () => {
  // Table of the especificação de parceiros §3.2 (illustrative values).
  it.each([
    [10_000, 3_000, 7_000],
    [20_000, 6_000, 14_000],
  ])(
    "splits %i cents into %i + %i at 30%% with R$ 30 minimum",
    (price, platform, partner) => {
      expect(
        computeSplit({
          priceCents: price,
          minPriceCents: 10_000,
          minPlatformShareCents: 3_000,
          platformPercentBp: 3_000,
        }),
      ).toEqual({ platformShareCents: platform, partnerShareCents: partner });
    },
  );

  it("applies the minimum platform share when the percentage is lower", () => {
    expect(
      computeSplit({
        priceCents: 10_000,
        minPriceCents: 5_000,
        minPlatformShareCents: 4_000,
        platformPercentBp: 3_000,
      }),
    ).toEqual({ platformShareCents: 4_000, partnerShareCents: 6_000 });
  });

  it("refuses a price below the floor (criterion 4)", () => {
    expect(() =>
      computeSplit({
        priceCents: 9_999,
        minPriceCents: 10_000,
        minPlatformShareCents: 3_000,
        platformPercentBp: 3_000,
      }),
    ).toThrow(AppError);
  });

  it("refuses fractional cents and percentages out of range", () => {
    const base = {
      priceCents: 10_000,
      minPriceCents: 0,
      minPlatformShareCents: 0,
      platformPercentBp: 3_000,
    };
    expect(() => computeSplit({ ...base, priceCents: 100.5 })).toThrow(
      AppError,
    );
    expect(() => computeSplit({ ...base, platformPercentBp: 10_001 })).toThrow(
      AppError,
    );
    expect(() => computeSplit({ ...base, platformPercentBp: -1 })).toThrow(
      AppError,
    );
  });

  it("always adds up to the price exactly and respects the minimum share", () => {
    // Deterministic pseudo-random cases (LCG), no floating point sums.
    let seed = 42;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };
    for (let i = 0; i < 5_000; i += 1) {
      const minPlatformShareCents = next(50_000);
      const minPriceCents = minPlatformShareCents + next(100_000);
      const priceCents = minPriceCents + next(1_000_000);
      const platformPercentBp = next(10_001);
      const { platformShareCents, partnerShareCents } = computeSplit({
        priceCents,
        minPriceCents,
        minPlatformShareCents,
        platformPercentBp,
      });
      expect(Number.isInteger(platformShareCents)).toBe(true);
      expect(platformShareCents + partnerShareCents).toBe(priceCents);
      expect(platformShareCents).toBeGreaterThanOrEqual(minPlatformShareCents);
      expect(partnerShareCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives everything to the platform in the partner pays mode", () => {
    expect(partnerPaysShares(3_000)).toEqual({
      platformShareCents: 3_000,
      partnerShareCents: 0,
    });
  });
});

describe("money helpers", () => {
  it("formats cents as reais", () => {
    expect(formatCents(123_456)).toMatch(/R\$\s1\.234,56/);
  });

  it.each([
    ["30", 3_000],
    ["30,5", 3_050],
    ["1.234,56", 123_456],
    ["R$ 99,99", 9_999],
    ["1234.56", 123_456],
  ])("parses %s as %i cents", (text, cents) => {
    expect(parseReais(text)).toBe(cents);
  });

  it.each(["", "abc", "1,234", "-5", "1,2,3", "12.3456"])(
    "rejects %s",
    (text) => {
      expect(parseReais(text)).toBeNull();
    },
  );
});
