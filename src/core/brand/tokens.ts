/**
 * Brand color tokens (ADR 0012, P3).
 *
 * A partner chooses one primary color. Every other token is derived here so
 * the pairs the UI relies on always meet WCAG AA (4.5:1): text on the primary
 * color, primary-colored text on the light surface and on the dark surface.
 * Only strict `#rrggbb` values ever reach the generated CSS, so the output
 * cannot carry arbitrary CSS.
 */

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** Light and dark surfaces from globals.css (`--color-surface`). */
const LIGHT_SURFACE = "#ffffff";
const DARK_SURFACE = "#191919";
const WHITE = "#ffffff";
const BLACK = "#000000";

export const MIN_CONTRAST = 4.5;

/** Lowercase `#rrggbb`, or null when the value is not a 6-digit hex color. */
export function normalizeHexColor(
  value: string | null | undefined,
): string | null {
  const color = value?.trim().toLowerCase();
  return color && HEX_COLOR.test(color) ? color : null;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `color` toward `target` by `amount` (0 keeps color, 1 is target). */
export function mixColors(
  color: string,
  target: string,
  amount: number,
): string {
  const from = channels(color);
  const to = channels(target);
  return toHex(
    [0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * amount) as [
      number,
      number,
      number,
    ],
  );
}

/** Moves `color` toward `target` until it reaches MIN_CONTRAST on `surface`. */
function readableOn(color: string, surface: string, target: string): string {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixColors(color, target, step / 20);
    if (contrastRatio(candidate, surface) >= MIN_CONTRAST) return candidate;
  }
  return target;
}

export type BrandPalette = Readonly<{
  primary: string;
  onPrimary: string;
  primaryHover: string;
  primaryText: string;
  primarySubtle: string;
  dark: Readonly<{
    primaryHover: string;
    primaryText: string;
    primarySubtle: string;
  }>;
}>;

/** Derives the accessible token set from one primary color. */
export function deriveBrandPalette(primaryColor: string): BrandPalette {
  const primary = normalizeHexColor(primaryColor);
  if (!primary) throw new Error("Cor primária inválida.");

  // Black or white: the better of the two always reaches 4.5:1.
  const onPrimary =
    contrastRatio(WHITE, primary) >= contrastRatio(BLACK, primary)
      ? WHITE
      : BLACK;

  return {
    primary,
    onPrimary,
    primaryHover: mixColors(primary, BLACK, 0.12),
    primaryText: readableOn(primary, LIGHT_SURFACE, BLACK),
    primarySubtle: mixColors(primary, WHITE, 0.88),
    dark: {
      primaryHover: mixColors(primary, WHITE, 0.12),
      primaryText: readableOn(primary, DARK_SURFACE, WHITE),
      primarySubtle: mixColors(primary, DARK_SURFACE, 0.75),
    },
  };
}

/**
 * CSS that overrides the primary tokens of globals.css. `html:root` and
 * `html[data-theme="dark"]` outrank the `:root` and `[data-theme="dark"]`
 * blocks of the stylesheet regardless of load order.
 */
export function brandCss(palette: BrandPalette): string {
  const values = [
    palette.primary,
    palette.onPrimary,
    palette.primaryHover,
    palette.primaryText,
    palette.primarySubtle,
    palette.dark.primaryHover,
    palette.dark.primaryText,
    palette.dark.primarySubtle,
  ];
  if (!values.every((v) => HEX_COLOR.test(v))) {
    throw new Error("Paleta de marca inválida.");
  }

  return (
    `html:root{--color-primary:${palette.primary};` +
    `--color-on-primary:${palette.onPrimary};` +
    `--color-primary-hover:${palette.primaryHover};` +
    `--color-primary-text:${palette.primaryText};` +
    `--color-primary-subtle:${palette.primarySubtle};}` +
    `html[data-theme="dark"]{--color-primary-hover:${palette.dark.primaryHover};` +
    `--color-primary-text:${palette.dark.primaryText};` +
    `--color-primary-subtle:${palette.dark.primarySubtle};}`
  );
}
