import { brandCss, type BrandPalette } from "@/core/brand/tokens";

/**
 * Overrides the primary color tokens with the partner brand (ADR 0012, P3).
 * `brandCss` only emits validated `#rrggbb` values, so the injected text
 * cannot carry markup or arbitrary CSS. Without a palette the design system
 * defaults from globals.css stay in place.
 */
export function BrandTokens({
  palette,
}: Readonly<{ palette: BrandPalette | null }>) {
  if (!palette) return null;
  return (
    <style
      id="brand-tokens"
      dangerouslySetInnerHTML={{ __html: brandCss(palette) }}
    />
  );
}
