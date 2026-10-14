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
  /** Logo for the dark theme (CF2); the light logo is used without it. */
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  /** Open Graph image, 1200x630 recommended. */
  shareImageUrl: string | null;
  tagline: string | null;
  /** Plain text; addresses in it become links when shown. */
  footerText: string | null;
  /** Sales contact shown on the login (CF2). */
  whatsapp: BrandWhatsapp | null;
}>;

export type BrandWhatsapp = Readonly<{
  /** Digits only, with country code. */
  number: string;
  label: string | null;
  message: string | null;
}>;
