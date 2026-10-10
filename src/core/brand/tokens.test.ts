import { describe, expect, it } from "vitest";

import {
  MIN_CONTRAST,
  brandCss,
  contrastRatio,
  deriveBrandPalette,
  normalizeHexColor,
} from "./tokens";

describe("normalizeHexColor", () => {
  it("accepts #rrggbb in any case and rejects everything else", () => {
    expect(normalizeHexColor(" #1976D2 ")).toBe("#1976d2");
    for (const value of ["1976d2", "#fff", "#1976d2ff", "red", "", null]) {
      expect(normalizeHexColor(value)).toBeNull();
    }
    expect(normalizeHexColor("#000000;}body{x")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});

describe("deriveBrandPalette", () => {
  it.each(["#1976d2", "#ffeb3b", "#00e676", "#212121", "#777777", "#ff00ff"])(
    "keeps every text pair readable for %s",
    (primary) => {
      const p = deriveBrandPalette(primary);
      expect(contrastRatio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(
        MIN_CONTRAST,
      );
      expect(contrastRatio(p.primaryText, "#ffffff")).toBeGreaterThanOrEqual(
        MIN_CONTRAST,
      );
      expect(
        contrastRatio(p.dark.primaryText, "#191919"),
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    },
  );

  it("uses dark text on light colors and white text on dark colors", () => {
    expect(deriveBrandPalette("#ffeb3b").onPrimary).toBe("#000000");
    expect(deriveBrandPalette("#0d47a1").onPrimary).toBe("#ffffff");
  });

  it("rejects an invalid color", () => {
    expect(() => deriveBrandPalette("blue")).toThrow();
  });
});

describe("brandCss", () => {
  it("emits only the primary token overrides with hex values", () => {
    const css = brandCss(deriveBrandPalette("#1976d2"));
    expect(css.startsWith("html:root{--color-primary:#1976d2;")).toBe(true);
    expect(css).toContain('html[data-theme="dark"]{');
    expect(css).not.toMatch(/[<>"']\s*(script|style)/i);
    expect(css.replace(/#[0-9a-f]{6}/g, "")).not.toMatch(/[0-9a-f]{6}/);
  });

  it("refuses a palette with a non-hex value", () => {
    const palette = deriveBrandPalette("#1976d2");
    expect(() =>
      brandCss({ ...palette, primary: "red;}*{display:none" }),
    ).toThrow();
  });
});
