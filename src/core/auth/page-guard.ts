import "server-only";
import { notFound, redirect } from "next/navigation";

import { isAccessDeniedError } from "./errors";
import { requireMfa, requireUser, type Identity } from "./identity";

/**
 * Page-level wrappers around the server guards.
 *
 * Route Handlers answer 401/403; pages have to send the browser to the state
 * that explains the denial. Both go through the same `decideAccess` rules — a
 * page is never the thing that decides.
 */
async function guardPage(
  guard: () => Promise<Identity>,
  currentPath: string,
): Promise<Identity> {
  try {
    return await guard();
  } catch (error) {
    if (isAccessDeniedError(error)) redirect(error.route(currentPath));
    throw error;
  }
}

export function requireUserPage(currentPath: string): Promise<Identity> {
  return guardPage(requireUser, currentPath);
}

export function requireMfaPage(currentPath: string): Promise<Identity> {
  return guardPage(requireMfa, currentPath);
}

/**
 * Server guard for internal administration pages (/platform).
 * Answers 404 outside the platform hosts (ADR 0012), then enforces both
 * Multi-Factor Authentication (AAL2) and active membership in
 * platform_admin_members (spec Section 7 and 12).
 */
export async function requirePlatformAdminPage(
  currentPath: string,
): Promise<Identity> {
  const { getRequestPartner } = await import("@/core/partners/resolve");
  const partner = await getRequestPartner();
  if (!partner?.isPlatformHost) {
    notFound();
  }

  const identity = await requireMfaPage(currentPath);
  const { prisma } = await import("@/lib/prisma/client");
  const { getPlatformAdminMember } = await import("@/core/admin/platform");

  const admin = await getPlatformAdminMember(prisma, identity.userId);
  if (!admin) {
    redirect("/auth/denied");
  }

  return identity;
}

/**
 * Server guard for the partner console (/admin, ADR 0012). The host selects
 * the partner (404 for unknown hosts); the identity needs AAL2 and an active
 * role in that partner, otherwise it is sent to the denial page.
 */
export async function requirePartnerConsolePage(currentPath: string) {
  const { getRequestPartner } = await import("@/core/partners/resolve");
  const partner = await getRequestPartner();
  if (!partner) {
    notFound();
  }

  const identity = await requireMfaPage(currentPath);
  const { prisma } = await import("@/lib/prisma/client");
  const { getPartnerMembership } = await import("@/core/partners/members");
  const membership = await getPartnerMembership(
    prisma,
    identity.userId,
    partner.partnerId,
  );
  if (!membership) {
    redirect("/auth/denied");
  }

  return { identity, partner, membership };
}
