import { describe, expect, it } from "vitest";

import { splitAmount } from "./amount";

describe("splitAmount", () => {
  it("splits a Brazilian real amount at the decimal comma", () => {
    const { whole, fraction } = splitAmount(121890.92, "pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    expect(whole.replace(/\s/g, " ")).toBe("R$ 121.890");
    expect(fraction).toBe(",92");
  });

  it("splits a dollar amount at the decimal point", () => {
    expect(
      splitAmount(-5005.48, "en", { style: "currency", currency: "USD" }),
    ).toEqual({ whole: "-$5,005", fraction: ".48" });
  });

  it("keeps a trailing currency symbol in the whole part", () => {
    const { whole, fraction } = splitAmount(84.2, "es", {
      style: "currency",
      currency: "EUR",
    });
    expect(fraction).toBe(",20");
    expect(whole.replace(/\s/g, " ")).toBe("84 €");
  });

  it("returns the number whole when it has no decimals", () => {
    expect(
      splitAmount(1284, "pt-BR", {
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }),
    ).toEqual({
      whole: "1.284",
      fraction: "",
    });
  });
});
