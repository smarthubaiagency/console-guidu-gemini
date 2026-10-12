import "server-only";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { getPartnerMembership } from "@/core/partners/members";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";

export type ConsoleAccess = Readonly<{
  /** Active internal role, on a platform host (/platform is 404 elsewhere). */
  platform: boolean;
  /** Member of the partner that owns the current host (/admin). */
  admin: boolean;
}>;

/**
 * Which consoles the person can open from the shell header (ADR 0014). Only
 * decides whether a shortcut is shown: /platform and /admin revalidate
 * identity, role, host and MFA themselves.
 */
export async function getConsoleAccess(userId: string): Promise<ConsoleAccess> {
  const partner = await getRequestPartner();
  const [platformAdmin, membership] = await Promise.all([
    partner?.isPlatformHost
      ? getPlatformAdminMember(prisma, userId)
      : Promise.resolve(null),
    partner
      ? getPartnerMembership(prisma, userId, partner.partnerId)
      : Promise.resolve(null),
  ]);
  return {
    platform: platformAdmin?.status === "active",
    admin: Boolean(membership),
  };
}
