import type { BrandPalette } from "./tokens";

/** Brand served on a host (ADR 0012). */
export type Brand = Readonly<{
  partnerId: string | null;
  /** "partner" when a brand version exists; otherwise the environment brand. */
  source: "partner" | "environment";
  version: number | null;
  name: string;
  primaryColor: string | null;
  palette: BrandPalette | null;
  supportEmail: string | null;
  supportUrl: string | null;
  /** Same-origin path of the active logo, or null. */
  logoUrl: string | null;
}>;
