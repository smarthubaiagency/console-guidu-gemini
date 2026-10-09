/**
 * ============================================================================
 * File: src/core/workspaces/members.ts
 * Module: Workspace Membership & RBAC Service
 *
 * Maintenance Rationale:
 * - Manages membership assignment and role updates within workspaces.
 * - Adheres to AC05 composite key constraint: (workspace_id, organization_id)
 *   ensuring no foreign organization membership can cross boundaries.
 * - Enforces workspace RBAC hierarchy (owner > admin > editor > viewer).
 * ============================================================================
 */

import type { ContextTransaction } from "@/lib/prisma/with-context";
import {
  canAssignWorkspaceRole,
  canManageWorkspaceMember,
  OrganizationRole,
  WorkspaceRole,
  WorkspaceRoles,
} from "../permissions/roles";
import { Permissions } from "../permissions/catalog";
import { requireWorkspacePermission } from "../permissions/guard";
import {
  InsufficientRoleError,
  LastOwnerCannotBeRemovedError,
  MemberNotFoundError,
} from "../organizations/errors";
import { recordAudit } from "../audit/record";

export type WorkspaceMemberItem = {
  workspaceId: string;
  organizationId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Lists all members of a contextual workspace.
 */
export async function listWorkspaceMembers(
  tx: ContextTransaction,
  workspaceId: string,
  organizationId: string,
): Promise<WorkspaceMemberItem[]> {
  return tx.workspaceMember.findMany({
    where: {
      workspaceId,
      organizationId,
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Adds an existing organization member to a specific workspace.
 */
export async function addWorkspaceMember(
  tx: ContextTransaction,
  params: {
    workspaceId: string;
    organizationId: string;
    actorId: string;
    targetUserId: string;
    role: WorkspaceRole;
  },
): Promise<WorkspaceMemberItem> {
  const { workspaceId, organizationId, actorId, targetUserId, role } = params;

  // 1. Validate actor workspace invitation permission via guard
  const { workspaceRole, organizationRole } = await requireWorkspacePermission(
    tx,
    { userId: actorId, workspaceId, organizationId },
    Permissions.WORKSPACE_MEMBERS_INVITE,
  );

  // 2. Validate actor privilege boundary to assign this role (AC04)
  if (!canAssignWorkspaceRole(organizationRole ?? undefined, workspaceRole, role)) {
    throw new InsufficientRoleError("add_workspace_member", "workspace admin");
  }

  // 3. Ensure target is already an active member of the organization
  const targetOrgMember = await tx.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });

  if (!targetOrgMember || targetOrgMember.status !== "active") {
    throw new MemberNotFoundError(targetUserId);
  }

  // 4. Upsert workspace member
  return tx.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: targetUserId,
      },
    },
    update: {
      role,
      status: "active",
    },
    create: {
      workspaceId,
      organizationId,
      userId: targetUserId,
      role,
      status: "active",
    },
  });
}

/**
 * Updates a workspace member's role.
 */
export async function updateWorkspaceMemberRole(
  tx: ContextTransaction,
  params: {
    workspaceId: string;
    organizationId: string;
    actorId: string;
    targetUserId: string;
    newRole: WorkspaceRole;
  },
): Promise<WorkspaceMemberItem> {
  const { workspaceId, organizationId, actorId, targetUserId, newRole } = params;

  // 1. Validate actor workspace member management permission via guard
  const { workspaceRole, organizationRole } = await requireWorkspacePermission(
    tx,
    { userId: actorId, workspaceId, organizationId },
    Permissions.WORKSPACE_MEMBERS_MANAGE,
  );

  // 2. Resolve target member
  const target = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });

  if (!target) {
    throw new MemberNotFoundError(targetUserId);
  }

  const targetRole = target.role as WorkspaceRole;

  // 3. Verify actor can manage this member and assign the target role (AC04)
  if (!canManageWorkspaceMember(organizationRole ?? undefined, workspaceRole, targetRole)) {
    throw new InsufficientRoleError("manage_workspace_member", "workspace owner");
  }

  if (!canAssignWorkspaceRole(organizationRole ?? undefined, workspaceRole, newRole)) {
    throw new InsufficientRoleError("assign_workspace_role", newRole);
  }

  // 4. Invariant AC04: Cannot demote the last active owner of a workspace
  if (
    targetRole === WorkspaceRoles.OWNER &&
    target.status === "active" &&
    newRole !== WorkspaceRoles.OWNER
  ) {
    const activeOwnerCount = await tx.workspaceMember.count({
      where: {
        workspaceId,
        role: WorkspaceRoles.OWNER,
        status: "active",
      },
    });

    if (activeOwnerCount <= 1) {
      throw new LastOwnerCannotBeRemovedError(workspaceId);
    }
  }

  try {
    const updated = await tx.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
      data: { role: newRole },
    });

    await recordAudit(
      tx,
      {
        userId: actorId,
        workspaceId,
        organizationId,
      },
      {
        action: "workspace_members.role_changed",
        resourceType: "workspace_member",
        resourceId: targetUserId,
        result: "success",
        origin: "app",
        metadata: {
          from: targetRole,
          to: newRole,
          targetUserId,
        },
      },
    );

    return updated;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes("last active owner") ||
        err.message.includes("P0001") ||
        err.message.includes("Cannot remove, revoke or demote the last active owner"))
    ) {
      throw new LastOwnerCannotBeRemovedError(workspaceId);
    }
    throw err;
  }
}

/**
 * Removes a member from a workspace.
 */
export async function removeWorkspaceMember(
  tx: ContextTransaction,
  params: {
    workspaceId: string;
    organizationId: string;
    actorId: string;
    targetUserId: string;
  },
): Promise<void> {
  const { workspaceId, organizationId, actorId, targetUserId } = params;

  const isSelf = actorId === targetUserId;

  // 1. Resolve & check actor roles via guard if not self-removal
  let actorRoles: {
    workspaceRole: WorkspaceRole;
    organizationRole: OrganizationRole | null;
  } | null = null;

  if (!isSelf) {
    actorRoles = await requireWorkspacePermission(
      tx,
      { userId: actorId, workspaceId, organizationId },
      Permissions.WORKSPACE_MEMBERS_MANAGE,
    );
  }

  // 2. Resolve target
  const target = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });

  if (!target) {
    throw new MemberNotFoundError(targetUserId);
  }

  const targetRole = target.role as WorkspaceRole;

  // 3. Permission verification (AC04)
  if (
    !isSelf &&
    actorRoles &&
    !canManageWorkspaceMember(
      actorRoles.organizationRole ?? undefined,
      actorRoles.workspaceRole,
      targetRole,
    )
  ) {
    throw new InsufficientRoleError("remove_workspace_member", "workspace owner");
  }

  // 4. Invariant AC04: Cannot remove the last active owner of a workspace (even if self-removing)
  if (targetRole === WorkspaceRoles.OWNER && target.status === "active") {
    const activeOwnerCount = await tx.workspaceMember.count({
      where: {
        workspaceId,
        role: WorkspaceRoles.OWNER,
        status: "active",
      },
    });

    if (activeOwnerCount <= 1) {
      throw new LastOwnerCannotBeRemovedError(workspaceId);
    }
  }

  // 5. Remove workspace membership
  try {
    await tx.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
    });

    await recordAudit(
      tx,
      {
        userId: actorId,
        workspaceId,
        organizationId,
      },
      {
        action: "workspace_members.removed",
        resourceType: "workspace_member",
        resourceId: targetUserId,
        result: "success",
        origin: "app",
        metadata: {
          role: targetRole,
          targetUserId,
        },
      },
    );
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes("last active owner") ||
        err.message.includes("P0001") ||
        err.message.includes("Cannot remove, revoke or demote the last active owner"))
    ) {
      throw new LastOwnerCannotBeRemovedError(workspaceId);
    }
    throw err;
  }
}
