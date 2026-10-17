import "server-only";

import { assertWithinQuota, resolveQuota } from "@/core/entitlements/quotas";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { INBOX_ATTENDANTS_QUOTA } from "./manifest";

/**
 * Attendant quota of the Inbox (IN4a, decision of 17/10/2026): it counts
 * who answers in the workspace, the Attendant role and the marked owners,
 * admins and editors. Pending invitations as Attendant hold a place too.
 * Going over a lower limit removes nobody: only new marks and invitations
 * are refused.
 */

/** Who answers in the context workspace now. */
export async function countAttendants(tx: ContextTransaction): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    select private.inbox_attendant_count() as n
  `;
  return Number(rows[0]?.n ?? 0);
}

async function pendingAttendantInvitations(
  tx: ContextTransaction,
  ctx: Pick<RequestContext, "organizationId" | "workspaceId">,
): Promise<number> {
  return tx.invitation.count({
    where: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      role: "attendant",
      status: "pending",
      expiresAt: { gt: new Date() },
    },
  });
}

/**
 * Refuses one more attendant over the limit of the plan. Serialized per
 * workspace by an advisory lock held until the end of the transaction.
 */
export async function assertAttendantSeat(
  tx: ContextTransaction,
  ctx: Pick<RequestContext, "organizationId" | "workspaceId">,
): Promise<void> {
  await tx.$executeRaw`
    select pg_advisory_xact_lock(hashtext('inbox_attendants:' || ${ctx.workspaceId}::text))
  `;
  const [quota, current, pending] = await Promise.all([
    resolveQuota(tx, ctx.organizationId, INBOX_ATTENDANTS_QUOTA),
    countAttendants(tx),
    pendingAttendantInvitations(tx, ctx),
  ]);
  assertWithinQuota(quota, current + pending, "atendentes do Inbox");
}

/** Usage of the Inbox quota, shown on "Consumo & Limites". */
export const inboxQuotaUsage = {
  [INBOX_ATTENDANTS_QUOTA]: {
    moduleKey: "inbox",
    scope: "workspace" as const,
    count: (tx: ContextTransaction) => countAttendants(tx),
  },
};
