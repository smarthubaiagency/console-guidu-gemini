import "server-only";

import type { PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { cache } from "react";

import { appConfig } from "@/core/config/app";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";
import { withPartnerContext } from "@/lib/prisma/with-partner-context";

import type { BrandImageKind } from "./logo";
import { deriveBrandPalette, normalizeHexColor } from "./tokens";
import type { Brand } from "./types";

/** Environment brand (ADR 0004): default for partners without a version. */
export function environmentBrand(partnerId: string | null): Brand {
  return {
    partnerId,
    source: "environment",
    version: null,
    name: appConfig.name,
    primaryColor: null,
    palette: null,
    supportEmail: null,
    supportUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    shareImageUrl: null,
    tagline: null,
    footerText: null,
    whatsapp: null,
  };
}

/** Path segment of each brand image, served by `/brand/[asset]/[version]`. */
export const BRAND_ASSET_SEGMENTS = {
  logo: "logo",
  logoDark: "logo-dark",
  favicon: "favicon",
  shareImage: "share",
} as const satisfies Record<BrandImageKind, string>;

export function brandAssetKind(segment: string): BrandImageKind | null {
  const entry = Object.entries(BRAND_ASSET_SEGMENTS).find(
    ([, value]) => value === segment,
  );
  return entry ? (entry[0] as BrandImageKind) : null;
}

export function brandAssetPath(kind: BrandImageKind, version: number): string {
  return `/brand/${BRAND_ASSET_SEGMENTS[kind]}/${version}`;
}

export function logoPath(version: number): string {
  return brandAssetPath("logo", version);
}

/** Active (highest) brand version of a partner, or the environment brand. */
export async function loadActiveBrand(
  client: PrismaClient,
  partnerId: string,
): Promise<Brand> {
  const row = await withPartnerContext(client, partnerId, (tx) =>
    tx.partnerBrand.findFirst({
      where: { partnerId },
      orderBy: { version: "desc" },
      select: {
        version: true,
        displayName: true,
        primaryColor: true,
        supportEmail: true,
        supportUrl: true,
        logoMime: true,
        logoDarkMime: true,
        faviconMime: true,
        shareImageMime: true,
        tagline: true,
        footerText: true,
        whatsappNumber: true,
        whatsappLabel: true,
        whatsappMessage: true,
      },
    }),
  );
  if (!row) return environmentBrand(partnerId);

  const primaryColor = normalizeHexColor(row.primaryColor);
  return {
    partnerId,
    source: "partner",
    version: row.version,
    name: row.displayName,
    primaryColor,
    palette: primaryColor ? deriveBrandPalette(primaryColor) : null,
    supportEmail: row.supportEmail,
    supportUrl: row.supportUrl,
    logoUrl: row.logoMime ? logoPath(row.version) : null,
    logoDarkUrl: row.logoDarkMime
      ? brandAssetPath("logoDark", row.version)
      : null,
    faviconUrl: row.faviconMime ? brandAssetPath("favicon", row.version) : null,
    shareImageUrl: row.shareImageMime
      ? brandAssetPath("shareImage", row.version)
      : null,
    tagline: row.tagline,
    footerText: row.footerText,
    whatsapp: row.whatsappNumber
      ? {
          number: row.whatsappNumber,
          label: row.whatsappLabel,
          message: row.whatsappMessage,
        }
      : null,
  };
}

/** Bytes of one image of one brand version of a partner. */
export async function loadBrandImage(
  client: PrismaClient,
  partnerId: string,
  version: number,
  kind: BrandImageKind,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const row = await withPartnerContext(client, partnerId, (tx) =>
    tx.partnerBrand.findUnique({
      where: { partnerId_version: { partnerId, version } },
      select: {
        logo: kind === "logo",
        logoMime: kind === "logo",
        logoDark: kind === "logoDark",
        logoDarkMime: kind === "logoDark",
        favicon: kind === "favicon",
        faviconMime: kind === "favicon",
        shareImage: kind === "shareImage",
        shareImageMime: kind === "shareImage",
      },
    }),
  );
  if (!row) return null;
  const [bytes, mime] = {
    logo: [row.logo, row.logoMime] as const,
    logoDark: [row.logoDark, row.logoDarkMime] as const,
    favicon: [row.favicon, row.faviconMime] as const,
    shareImage: [row.shareImage, row.shareImageMime] as const,
  }[kind];
  return bytes && mime ? { bytes: new Uint8Array(bytes), mime } : null;
}

/** Logo bytes of one brand version of a partner. */
export function loadBrandLogo(
  client: PrismaClient,
  partnerId: string,
  version: number,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  return loadBrandImage(client, partnerId, version, "logo");
}

/**
 * Brand of the current request host, resolved once per request. The brand is
 * presentation only: if it cannot be read (database unavailable), the page
 * still renders with the environment brand instead of failing.
 */
export const getRequestBrand = cache(async (): Promise<Brand> => {
  // Outside the try: reading the headers is what makes the page dynamic, and
  // Next.js signals that by throwing during prerendering. Swallowing it would
  // freeze the environment brand into static pages served to every host.
  await headers();

  let partnerId: string | null = null;
  try {
    const partner = await getRequestPartner();
    if (!partner) return environmentBrand(null);
    partnerId = partner.partnerId;
    return await loadActiveBrand(prisma, partner.partnerId);
  } catch (error) {
    appLog.error("brand.fallback", {
      partnerId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return environmentBrand(partnerId);
  }
});
