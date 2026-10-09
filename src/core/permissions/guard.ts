/**
 * ============================================================================
 * File: src/core/permissions/guard.ts
 * Module: Server-Side Permissions Guard
 *
 * Maintenance Rationale:
 * - Specification Section 7 & Section 25 Invariant:
 *   "Papel é dado; permissão é a pergunta. Centralizar a pergunta no guard,
 *    lendo o estado atual do banco dentro da transação contextualizada, garante
 *    revogação imediata (AC03) e uma regra única para REST, MCP e páginas (§4)."
 * - Reads current active membership directly from database within withContext.
 * - Never trusts or accepts user-supplied role parameters from client.
 * ============================================================================
 */

import "server-only";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import {
  ALL_PERMISSIONS,
  Permission,
  PermissionKey,
  Permissions,
} from "./catalog";
import {
  hasOrganizationRolePermission,
  hasWorkspaceRolePermission,
} from "./matrix";
import {
  OrganizationRole,
  OrganizationRoles,
  WorkspaceRole,
  WorkspaceRoles,
} from "./roles";
import { recordAuditDenied } from "@/core/audit/record";
import { getModulePermissionRoles } from "@/modules/registry";

/**
 * Whether a workspace role grants a permission: core permissions come from the
 * matrix, module permissions from the defaults declared in the registered
 * manifest. Unknown permissions are denied.
 */
export function workspaceRoleGrants(
  role: WorkspaceRole,
  permission: PermissionKey,
): boolean {
  if (ALL_PERMISSIONS.has(permission as Permission)) {
    return hasWorkspaceRolePermission(role, permission as Permission);
  }
  return getModulePermissionRoles(permission)?.includes(role) ?? false;
}

/**
 * Domain error thrown when an actor lacks required permissions or an active membership.
 * Contains generic message to avoid disclosing operational metadata.
 */
export class PermissionDeniedError extends Error {
  readonly code = "forbidden" as const;
  readonly status = 403 as const;

  constructor(message = "Você não tem permissão para esta ação.") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function isPermissionDeniedError(
  error: unknown,
): error is PermissionDeniedError {
  return error instanceof PermissionDeniedError;
}

async function handleCriticalPermissionDenial(
  ctx: RequestContext,
  permission: PermissionKey,
): Promise<void> {
  if (
    permission === Permissions.CREDENTIALS_MANAGE ||
    permission === Permissions.API_KEYS_REVOKE_ANY ||
    permission === Permissions.WORKSPACE_MEMBERS_MANAGE
  ) {
    const resourceType =
      permission === Permissions.CREDENTIALS_MANAGE
        ? "credential"
        : permission === Permissions.API_KEYS_REVOKE_ANY
          ? "api_key"
          : "workspace_member";

    await recordAuditDenied(ctx, {
      action: permission,
      resourceType,
    });
  }
}

/**
 * Validates that the contextual identity has the required workspace permission.
 * Resolves active workspace and organization memberships within the transaction.
 *
 * @throws {PermissionDeniedError} when actor is not an active member or lacks permission.
 */
export async function requireWorkspacePermission(
  tx: ContextTransaction,
  ctx: RequestContext,
  permission: PermissionKey,
): Promise<{
  workspaceRole: WorkspaceRole;
  organizationRole: OrganizationRole | null;
}> {
  const [wsMember, orgMember] = await Promise.all([
    tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
        },
      },
    }),
    tx.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        },
      },
    }),
  ]);

  const isWsActive = wsMember?.status === "active";
  const isOrgActive = orgMember?.status === "active";
  const orgRole = isOrgActive ? (orgMember.role as OrganizationRole) : null;

  // If workspace membership exists and is active:
  if (wsMember && isWsActive) {
    const wsRole = wsMember.role as WorkspaceRole;

    if (workspaceRoleGrants(wsRole, permission)) {
      return { workspaceRole: wsRole, organizationRole: orgRole };
    }

    // Spec §7: Organization owner has authority to manage workspace access
    if (
      orgRole === OrganizationRoles.OWNER &&
      (permission === Permissions.WORKSPACE_MEMBERS_INVITE ||
        permission === Permissions.WORKSPACE_MEMBERS_MANAGE)
    ) {
      return { workspaceRole: wsRole, organizationRole: orgRole };
    }

    await handleCriticalPermissionDenial(ctx, permission);
    throw new PermissionDeniedError();
  }

  // If workspace membership exists but is inactive, deny immediately (AC03)
  if (wsMember && !isWsActive) {
    await handleCriticalPermissionDenial(ctx, permission);
    throw new PermissionDeniedError();
  }

  // If user has no workspace membership row, but is active Organization Owner delegating access (§7)
  if (
    !wsMember &&
    orgRole === OrganizationRoles.OWNER &&
    (permission === Permissions.WORKSPACE_MEMBERS_INVITE ||
      permission === Permissions.WORKSPACE_MEMBERS_MANAGE)
  ) {
    return {
      workspaceRole: WorkspaceRoles.OWNER,
      organizationRole: orgRole,
    };
  }

  // Otherwise, user lacks active membership in this workspace
  await handleCriticalPermissionDenial(ctx, permission);
  throw new PermissionDeniedError();
}

/**
 * Resolves the effective workspace role for the current contextual identity.
 * Returns null if user is inactive, blocked or has no active role in the workspace.
 */
export async function getEffectiveWorkspaceRole(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<WorkspaceRole | null> {
  const [wsMember, orgMember] = await Promise.all([
    tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
        },
      },
    }),
    tx.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        },
      },
    }),
  ]);

  if (wsMember && wsMember.status === "active") {
    return wsMember.role as WorkspaceRole;
  }

  if (wsMember && wsMember.status !== "active") {
    return null;
  }

  if (
    orgMember &&
    orgMember.status === "active" &&
    orgMember.role === OrganizationRoles.OWNER
  ) {
    return WorkspaceRoles.OWNER;
  }

  return null;
}

/**
 * Validates that the contextual identity has the required organization permission.
 * Resolves active organization membership within the transaction.
 *
 * @throws {PermissionDeniedError} when actor is not an active member or lacks permission.
 */
export async function requireOrganizationPermission(
  tx: ContextTransaction,
  ctx: RequestContext,
  permission: Permission,
): Promise<{
  organizationRole: OrganizationRole;
}> {
  const orgMember = await tx.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
      },
    },
  });

  if (!orgMember || orgMember.status !== "active") {
    throw new PermissionDeniedError();
  }

  const orgRole = orgMember.role as OrganizationRole;
  if (!hasOrganizationRolePermission(orgRole, permission)) {
    throw new PermissionDeniedError();
  }

  return { organizationRole: orgRole };
}
