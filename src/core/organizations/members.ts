/**
 * ============================================================================
 * File: src/core/organizations/members.ts
 * Module: Organization Membership & RBAC Service
 *
 * Maintenance Rationale:
 * - Implements AC04: Strictly prevents removing, demoting or revoking the
 *   last active owner of an organization.
 * - Enforces role elevation controls: Admins cannot promote to owner or
 *   modify existing owners.
 * - Always runs inside a contextual Prisma transaction (ContextTransaction)
 *   satisfying ADR 0001.
 * ============================================================================
 */

import type { ContextTransaction } from "@/lib/prisma/with-context";
import {
  canAssignOrganizationRole,
  canManageOrganizationMember,
  OrganizationRole,
  OrganizationRoles,
} from "../permissions/roles";
import {
  InsufficientRoleError,
  LastOwnerCannotBeRemovedError,
  MemberNotFoundError,
} from "./errors";

export type OrganizationMemberItem = {
  userId: string;
  organizationId: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Lists all members of the contextual organization.
 */
export async function listOrganizationMembers(
  tx: ContextTransaction,
  organizationId: string,
): Promise<OrganizationMemberItem[]> {
  return tx.organizationMember.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Updates the organization role of a target member.
 *
 * Enforces AC04:
 * 1. Actor must be an active owner or admin.
 * 2. Actor cannot assign a role higher than allowed (admin cannot assign owner).
 * 3. Actor cannot manage an owner unless actor is an owner.
 * 4. Demoting the last active owner of the organization is strictly forbidden.
 */
export async function updateOrganizationMemberRole(
  tx: ContextTransaction,
  params: {
    organizationId: string;
    actorId: string;
    targetUserId: string;
    newRole: OrganizationRole;
  },
): Promise<OrganizationMemberItem> {
  const { organizationId, actorId, targetUserId, newRole } = params;

  // 1. Resolve actor's membership
  const actor = await tx.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: actorId,
      },
    },
  });

  if (!actor || actor.status !== "active") {
    throw new InsufficientRoleError("update_member_role", "active member");
  }

  const actorRole = actor.role as OrganizationRole;

  // 2. Resolve target member
  const target = await tx.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: targetUserId,
      },
    },
  });

  if (!target) {
    throw new MemberNotFoundError(targetUserId);
  }

  const targetRole = target.role as OrganizationRole;

  // 3. Check role management permissions
  if (!canManageOrganizationMember(actorRole, targetRole)) {
    throw new InsufficientRoleError(
      "manage_member",
      `role higher than ${targetRole}`,
    );
  }

  // 4. Check role assignment permissions (AC04: admin cannot promote to owner)
  if (!canAssignOrganizationRole(actorRole, newRole)) {
    throw new InsufficientRoleError("assign_role", "owner");
  }

  // 5. Invariant AC04: If target is an active owner and is being demoted, verify count
  if (
    targetRole === OrganizationRoles.OWNER &&
    target.status === "active" &&
    newRole !== OrganizationRoles.OWNER
  ) {
    const activeOwnerCount = await tx.organizationMember.count({
      where: {
        organizationId,
        role: OrganizationRoles.OWNER,
        status: "active",
      },
    });

    if (activeOwnerCount <= 1) {
      throw new LastOwnerCannotBeRemovedError(organizationId);
    }
  }

  // 6. Execute update
  return tx.organizationMember.update({
    where: {
      organizationId_userId: {
        organizationId,
        userId: targetUserId,
      },
    },
    data: {
      role: newRole,
    },
  });
}

/**
 * Removes a member from an organization.
 *
 * Enforces AC04:
 * 1. Actor must be an active owner or admin (or the member leaving voluntarily).
 * 2. An admin cannot remove an owner.
 * 3. The last active owner cannot be removed under any circumstance.
 */
export async function removeOrganizationMember(
  tx: ContextTransaction,
  params: {
    organizationId: string;
    actorId: string;
    targetUserId: string;
  },
): Promise<void> {
  const { organizationId, actorId, targetUserId } = params;

  const isSelf = actorId === targetUserId;

  // 1. Resolve actor membership
  const actor = await tx.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: actorId,
      },
    },
  });

  if (!actor || actor.status !== "active") {
    throw new InsufficientRoleError("remove_member", "active member");
  }

  const actorRole = actor.role as OrganizationRole;

  // 2. Resolve target membership
  const target = await tx.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: targetUserId,
      },
    },
  });

  if (!target) {
    throw new MemberNotFoundError(targetUserId);
  }

  const targetRole = target.role as OrganizationRole;

  // 3. Permission verification: non-self removal requires authorization
  if (!isSelf && !canManageOrganizationMember(actorRole, targetRole)) {
    throw new InsufficientRoleError("remove_member", "owner");
  }

  // 4. Invariant AC04: Cannot remove the last active owner (even if self-removing)
  if (targetRole === OrganizationRoles.OWNER && target.status === "active") {
    const activeOwnerCount = await tx.organizationMember.count({
      where: {
        organizationId,
        role: OrganizationRoles.OWNER,
        status: "active",
      },
    });

    if (activeOwnerCount <= 1) {
      throw new LastOwnerCannotBeRemovedError(organizationId);
    }
  }

  // 5. Clean up workspace memberships in this organization for this user
  await tx.workspaceMember.deleteMany({
    where: {
      organizationId,
      userId: targetUserId,
    },
  });

  // 6. Remove organization membership
  await tx.organizationMember.delete({
    where: {
      organizationId_userId: {
        organizationId,
        userId: targetUserId,
      },
    },
  });
}
