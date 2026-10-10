import type { PrismaClient } from "@prisma/client";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { isPartnerRole, type PartnerRoleKey } from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { invalidPartnerInput, partnerNotFound } from "./errors";

/**
 * Partner console data (ADR 0012, P4a). Everything runs in the partner
 * context of the request host; RLS limits it to that partner and gives no
 * access to workspace data.
 */

export type PartnerMembership = Readonly<{
  partnerId: string;
  partnerName: string;
  role: PartnerRoleKey;
}>;

/** Active role of the user in an active partner, or null. */
export async function getPartnerMembership(
  prisma: PrismaClient,
  userId: string,
  partnerId: string,
): Promise<PartnerMembership | null> {
  return withIdentityContext(
    prisma,
    userId,
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ role: string | null }>>`
        select private.current_partner_role() as role
      `;
      const role = rows[0]?.role;
      if (!role || !isPartnerRole(role)) return null;
      const partner = await tx.partner.findUnique({
        where: { id: partnerId },
        select: { name: true },
      });
      return { partnerId, partnerName: partner?.name ?? "Parceiro", role };
    },
    { partnerId },
  );
}

export type PartnerMemberItem = Readonly<{
  userId: string;
  email: string;
  role: PartnerRoleKey;
  status: string;
}>;

export async function listPartnerMembers(
  tx: ContextTransaction,
  partnerId: string,
): Promise<PartnerMemberItem[]> {
  const rows = await tx.partnerMember.findMany({
    where: { partnerId },
    orderBy: [{ status: "asc" }, { email: "asc" }],
  });
  return rows
    .filter((r) => isPartnerRole(r.role))
    .map((r) => ({
      userId: r.userId,
      email: r.email,
      role: r.role as PartnerRoleKey,
      status: r.status,
    }));
}

export async function listPendingPartnerInvitations(
  tx: ContextTransaction,
  partnerId: string,
) {
  return tx.partnerInvitation.findMany({
    where: { partnerId, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
}

/** Companies of the partner: metadata only, never workspace data. */
export async function listPartnerCustomers(
  tx: ContextTransaction,
  partnerId: string,
) {
  return tx.organization.findMany({
    where: { partnerId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, createdAt: true },
  });
}

/**
 * Changes the role or status of another member. Only the partner_owner, and
 * never on their own row, so a partner always keeps at least the acting owner.
 */
export async function updatePartnerMember(
  tx: ContextTransaction,
  actor: Readonly<{ userId: string; partnerRole: PartnerRoleKey | null }>,
  partnerId: string,
  userId: string,
  change: Readonly<{ role?: string; status?: "active" | "inactive" }>,
): Promise<void> {
  if (actor.partnerRole !== "partner_owner") throw new PermissionDeniedError();
  if (actor.userId === userId) {
    throw invalidPartnerInput("Você não pode alterar o seu próprio acesso.");
  }
  if (change.role !== undefined && !isPartnerRole(change.role)) {
    throw invalidPartnerInput("Papel inválido.");
  }

  const member = await tx.partnerMember.findUnique({
    where: { partnerId_userId: { partnerId, userId } },
  });
  if (!member) throw partnerNotFound();

  const role = change.role ?? member.role;
  const status = change.status ?? member.status;
  if (role === member.role && status === member.status) return;

  await tx.partnerMember.update({
    where: { partnerId_userId: { partnerId, userId } },
    data: { role, status },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.member.update",
    resourceType: "partner_member",
    resourceId: partnerId,
    result: "success",
    origin: "app",
    metadata: {
      targetUserId: userId,
      from: `${member.role}/${member.status}`,
      to: `${role}/${status}`,
    },
  });
}
