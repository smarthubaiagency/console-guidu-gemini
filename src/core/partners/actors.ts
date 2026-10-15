import "server-only";

import { readPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { isAreaIpAllowed } from "@/core/security/ip-gate";
import { prisma } from "@/lib/prisma/client";
import { AppError } from "@/shared/errors";

import { readPartnerMembership } from "./members";
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

/** Refusal of the IP allow list of the console (CF5a). */
function ipBlocked(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Seu endereço de rede não está liberado para esta área.",
    messageKey: "security.errors.ipBlocked",
  });
}

/**
 * Platform console actor: AAL2, platform host, active internal role and an
 * address the /platform IP allow list accepts.
 */
export async function platformActor() {
  const identity = await requireMfa();
  const partner = await getRequestPartner();
  if (!partner?.isPlatformHost) throw notFound();
  const admin = await readPlatformAdminMember(prisma, identity.userId);
  if (admin && !(await isAreaIpAllowed(prisma, "platform", null))) {
    throw ipBlocked();
  }
  return {
    userId: identity.userId,
    partnerId: partner.partnerId,
    role: admin?.status === "active" ? admin.role : null,
  };
}

/**
 * Partner console actor: AAL2, an active role in the host's partner and an
 * address the partner's /admin IP allow list accepts.
 */
export async function partnerActor() {
  const identity = await requireMfa();
  const partner = await getRequestPartner();
  if (!partner) throw notFound();
  const membership = await readPartnerMembership(
    prisma,
    identity.userId,
    partner.partnerId,
  );
  if (
    membership &&
    !(await isAreaIpAllowed(prisma, "admin", partner.partnerId))
  ) {
    throw ipBlocked();
  }
  return {
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership?.role ?? null,
  };
}
