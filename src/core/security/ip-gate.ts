import type { PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

import { clientIp, trustedProxyHops } from "./client-ip";

/**
 * IP allow lists at the door of /platform and /admin (CF5a). The role
 * lookups of both consoles (`getPlatformAdminMember`, `getPartnerMembership`)
 * and their guards ask this module, so every page and action of the area is
 * covered. API keys never pass here.
 *
 * - No list for the area: everybody passes.
 * - A list and an address inside it: passes.
 * - A list and an address outside it, or no readable address: refused.
 * - Outside a request (worker, scripts, tests) there is no address and no
 *   check: nothing a visitor controls runs there.
 * - `SECURITY_IP_ALLOWLIST=off` turns the check off in an emergency
 *   (docs/operacao/seguranca.md).
 */

export type AllowlistArea = "platform" | "admin";

export function ipGateDisabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.SECURITY_IP_ALLOWLIST?.trim().toLowerCase() === "off";
}

/** The visitor's address in this request, or null when unreadable. */
export const requestClientIp = cache(async (): Promise<string | null> => {
  const requestHeaders = await headers();
  return clientIp(
    (name) => requestHeaders.get(name),
    trustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
  );
});

/** Undefined outside a request: there is no address to check. */
async function currentAddress(): Promise<string | null | undefined> {
  try {
    return await requestClientIp();
  } catch (error) {
    unstable_rethrow(error);
    return undefined;
  }
}

const allowedInRequest = cache(
  async (
    prisma: PrismaClient,
    area: AllowlistArea,
    partnerId: string | null,
    ip: string | null,
  ): Promise<boolean> => {
    const rows = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
      select private.ip_allowed(${area}, ${partnerId}::uuid, ${ip}::inet) as allowed
    `;
    return rows[0]?.allowed === true;
  },
);

/** May the request enter the area? (`partnerId` for the /admin area.) */
export async function isAreaIpAllowed(
  prisma: PrismaClient,
  area: AllowlistArea,
  partnerId: string | null,
): Promise<boolean> {
  if (ipGateDisabled()) return true;
  const ip = await currentAddress();
  if (ip === undefined) return true;
  return allowedInRequest(
    prisma,
    area,
    area === "admin" ? partnerId : null,
    ip,
  );
}
