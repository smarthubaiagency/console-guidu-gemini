import "server-only";

import type { PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { cache } from "react";

import { appConfig } from "@/core/config/app";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withPartnerContext } from "@/lib/prisma/with-partner-context";

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
  };
}

export function logoPath(version: number): string {
  return `/brand/logo/${version}`;
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
  };
}

/** Logo bytes of one brand version of a partner. */
export async function loadBrandLogo(
  client: PrismaClient,
  partnerId: string,
  version: number,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const row = await withPartnerContext(client, partnerId, (tx) =>
    tx.partnerBrand.findUnique({
      where: { partnerId_version: { partnerId, version } },
      select: { logo: true, logoMime: true },
    }),
  );
  return row?.logo && row.logoMime
    ? { bytes: new Uint8Array(row.logo), mime: row.logoMime }
    : null;
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
    console.error("brand: falling back to the environment brand", {
      partnerId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return environmentBrand(partnerId);
  }
});
