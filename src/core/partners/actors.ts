import "server-only";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { prisma } from "@/lib/prisma/client";
import { AppError } from "@/shared/errors";

import { getPartnerMembership } from "./members";
import { getRequestPartner } from "./resolve";

/**
 * Actors of server actions in the consoles (ADR 0012). The host selects the
 * console: /platform only on platform hosts, /admin on the host's partner.
 * Roles are read here and checked again by the domain and by RLS.
 */

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
  });
}

/** Platform console actor: AAL2, platform host and active internal role. */
export async function platformActor() {
  const identity = await requireMfa();
  const partner = await getRequestPartner();
  if (!partner?.isPlatformHost) throw notFound();
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    userId: identity.userId,
    partnerId: partner.partnerId,
    role: admin?.status === "active" ? admin.role : null,
  };
}

/** Partner console actor: AAL2 and an active role in the host's partner. */
export async function partnerActor() {
  const identity = await requireMfa();
  const partner = await getRequestPartner();
  if (!partner) throw notFound();
  const membership = await getPartnerMembership(
    prisma,
    identity.userId,
    partner.partnerId,
  );
  return {
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership?.role ?? null,
  };
}
