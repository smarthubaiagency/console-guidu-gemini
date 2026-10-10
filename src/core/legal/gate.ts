import "server-only";

import { redirect } from "next/navigation";

import type { Identity } from "@/core/auth/identity";
import { safeInternalPath } from "@/core/auth/redirects";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { pendingLegalDocuments } from "./service";

/**
 * Sends the identity to /legal/accept while the partner of the request host
 * has terms or a privacy policy it has not accepted yet (P4b2).
 */
export async function requireLegalAcceptance(
  identity: Identity,
  currentPath: string,
): Promise<void> {
  const partner = await getRequestPartner();
  if (!partner) return;
  const pending = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => pendingLegalDocuments(tx, partner.partnerId, identity.userId),
    { partnerId: partner.partnerId },
  );
  if (pending.length > 0) {
    redirect(
      `/legal/accept?next=${encodeURIComponent(safeInternalPath(currentPath))}`,
    );
  }
}
