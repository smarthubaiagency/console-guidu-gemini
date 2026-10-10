import "server-only";

import type { PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { cache } from "react";

import { appOrigin } from "@/core/auth/origin";
import { prisma } from "@/lib/prisma/client";

import { HOUSE_PARTNER_ID } from "./constants";
import { normalizeHost, partnerHostOrigin, platformHosts } from "./hosts";

export type RequestPartner = Readonly<{
  partnerId: string;
  host: string;
  /** True on platform hosts, where `/platform` is served (ADR 0012). */
  isPlatformHost: boolean;
}>;

type PartnerHostRow = { partner_id: string };

/**
 * Maps a request host to its partner: platform hosts resolve to the house
 * partner; other hosts must be an active domain of an active partner.
 * Returns null for unknown hosts, which then see no workspace at all.
 */
export async function resolvePartnerForHost(
  client: PrismaClient,
  rawHost: string | null | undefined,
): Promise<RequestPartner | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;

  if (platformHosts(process.env).has(host)) {
    return { partnerId: HOUSE_PARTNER_ID, host, isPlatformHost: true };
  }

  const rows = await client.$queryRaw<PartnerHostRow[]>`
    select partner_id from private.resolve_partner_host(${host})
  `;
  const partnerId = rows[0]?.partner_id;
  return partnerId ? { partnerId, host, isPlatformHost: false } : null;
}

/** Partner of the current request, resolved once per request. */
export const getRequestPartner = cache(
  async (): Promise<RequestPartner | null> => {
    const requestHeaders = await headers();
    return resolvePartnerForHost(prisma, requestHeaders.get("host"));
  },
);

/**
 * Origin for links sent to users of the current host (invitations, P3).
 * Platform hosts use the operator-controlled APP_URL. A partner host is used
 * only after it matched an active partner domain (https in production).
 * Null for unknown hosts.
 */
export async function getRequestOrigin(): Promise<string | null> {
  const partner = await getRequestPartner();
  if (!partner) return null;
  return partner.isPlatformHost
    ? appOrigin()
    : partnerHostOrigin(partner.host, process.env);
}
