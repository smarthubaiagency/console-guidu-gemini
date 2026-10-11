import type { PrismaClient } from "@prisma/client";

import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Who calls the platform API or MCP (F4e): an internal role member, through
 * an administrative key or the browser session of the platform host.
 */
export type PlatformActor = Readonly<{
  userId: string;
  role: PlatformAdminRoleKey;
  /** Administrative key id, absent for the browser session. */
  keyId: string | null;
}>;

/**
 * Transaction with the identity of the member and no workspace: the
 * platform policies and helpers read `app.user_id`. A key call is recorded
 * as principal `api_key` with the key as grant.
 */
export async function withPlatformContext<T>(
  prisma: PrismaClient,
  actor: Pick<PlatformActor, "userId" | "keyId">,
  operation: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      select
        set_config('app.user_id', ${actor.userId}, true),
        set_config('app.principal_type', ${actor.keyId ? "api_key" : "user"}, true),
        set_config('app.grant_id', ${actor.keyId ?? ""}, true),
        set_config('app.partner_id', ${HOUSE_PARTNER_ID}, true)
    `;
    return operation(tx);
  });
}

/** Audit context of a platform call: no workspace or organization. */
export function platformAuditContext(
  actor: Pick<PlatformActor, "userId" | "keyId">,
): RequestContext {
  return {
    userId: actor.userId,
    workspaceId: "",
    organizationId: "",
    principalType: actor.keyId ? "api_key" : "user",
    grantId: actor.keyId,
  };
}
