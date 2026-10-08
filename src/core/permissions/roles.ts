/**
 * ============================================================================
 * File: src/core/permissions/roles.ts
 * Module: RBAC (Role-Based Access Control) & Permissions Engine
 *
 * Maintenance Rationale:
 * - Centralizes all domain role definitions and hierarchy invariants (AC04).
 * - Avoids sprinkling loose string comparisons or hardcoded role checks across
 *   the codebase (spec section 7).
 * - Enforces the invariant: An admin cannot promote themselves or others to
 *   'owner', and cannot demote or remove an 'owner'. Only an active 'owner' can
 *   transfer ownership or manage fellow owners.
 * ============================================================================
 */

export const OrganizationRoles = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type OrganizationRole =
  (typeof OrganizationRoles)[keyof typeof OrganizationRoles];

export const WorkspaceRoles = {
  OWNER: "owner",
  ADMIN: "admin",
  EDITOR: "editor",
  VIEWER: "viewer",
} as const;

export type WorkspaceRole = (typeof WorkspaceRoles)[keyof typeof WorkspaceRoles];

export const InvitationStatuses = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REVOKED: "revoked",
  EXPIRED: "expired",
} as const;

export type InvitationStatus =
  (typeof InvitationStatuses)[keyof typeof InvitationStatuses];

/** Numerical ranks for organization roles to determine escalation ceilings. */
export const ORG_ROLE_RANK: Record<OrganizationRole, number> = {
  [OrganizationRoles.OWNER]: 300,
  [OrganizationRoles.ADMIN]: 200,
  [OrganizationRoles.MEMBER]: 100,
};

/** Numerical ranks for workspace roles. */
export const WS_ROLE_RANK: Record<WorkspaceRole, number> = {
  [WorkspaceRoles.OWNER]: 400,
  [WorkspaceRoles.ADMIN]: 300,
  [WorkspaceRoles.EDITOR]: 200,
  [WorkspaceRoles.VIEWER]: 100,
};

/**
 * Validates whether a given string is a valid OrganizationRole.
 */
export function isOrganizationRole(role: string): role is OrganizationRole {
  return Object.values(OrganizationRoles).includes(role as OrganizationRole);
}

/**
 * Validates whether a given string is a valid WorkspaceRole.
 */
export function isWorkspaceRole(role: string): role is WorkspaceRole {
  return Object.values(WorkspaceRoles).includes(role as WorkspaceRole);
}

/**
 * AC04 Privilege Boundary:
 * Checks whether an actor with `actorRole` is allowed to invite or assign
 * a target member with `targetRole` in an organization.
 * - An owner can assign any role (owner, admin, member).
 * - An admin can only assign roles strictly below owner (admin, member).
 * - Regular members cannot invite or assign roles.
 */
export function canAssignOrganizationRole(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole,
): boolean {
  if (actorRole === OrganizationRoles.OWNER) {
    return true;
  }
  if (actorRole === OrganizationRoles.ADMIN) {
    // Admin cannot assign or promote to OWNER (AC04)
    return targetRole !== OrganizationRoles.OWNER;
  }
  return false;
}

/**
 * Checks whether an actor can manage (update role or remove) a target member
 * based on their current organization roles.
 * - Owners can manage any member.
 * - Admins can only manage members whose rank is strictly lower or equal to admin,
 *   and NEVER an owner.
 */
export function canManageOrganizationMember(
  actorRole: OrganizationRole,
  targetMemberRole: OrganizationRole,
): boolean {
  if (actorRole === OrganizationRoles.OWNER) {
    return true;
  }
  if (actorRole === OrganizationRoles.ADMIN) {
    // Admins cannot manage, demote or remove owners (AC04)
    return targetMemberRole !== OrganizationRoles.OWNER;
  }
  return false;
}

/**
 * Checks whether an actor can invite or assign a target workspace role.
 * - Organization owners or workspace owners can assign any workspace role.
 * - Workspace admins can only assign roles at or below admin (admin, editor, viewer).
 */
export function canAssignWorkspaceRole(
  actorOrgRole?: OrganizationRole,
  actorWsRole?: WorkspaceRole,
  targetRole?: WorkspaceRole,
): boolean {
  if (!targetRole) return false;
  if (actorOrgRole === OrganizationRoles.OWNER) {
    return true;
  }
  if (actorWsRole === WorkspaceRoles.OWNER) {
    return true;
  }
  if (actorWsRole === WorkspaceRoles.ADMIN) {
    return targetRole !== WorkspaceRoles.OWNER;
  }
  return false;
}

/**
 * Checks whether an actor can remove or edit a workspace member.
 */
export function canManageWorkspaceMember(
  actorOrgRole?: OrganizationRole,
  actorWsRole?: WorkspaceRole,
  targetMemberRole?: WorkspaceRole,
): boolean {
  if (!targetMemberRole) return false;
  if (actorOrgRole === OrganizationRoles.OWNER) {
    return true;
  }
  if (actorWsRole === WorkspaceRoles.OWNER) {
    return true;
  }
  if (actorWsRole === WorkspaceRoles.ADMIN) {
    return targetMemberRole !== WorkspaceRoles.OWNER;
  }
  return false;
}
