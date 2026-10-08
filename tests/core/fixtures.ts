export const ids = {
  organizationA: "a0000000-0000-4000-8000-000000000010",
  organizationB: "a0000000-0000-4000-8000-000000000020",
  workspaceA: "a0000000-0000-4000-8000-000000000011",
  workspaceB: "a0000000-0000-4000-8000-000000000021",
  /** Active owner of organization A and workspace A. */
  userA: "a0000000-0000-4000-8000-000000000031",
  /** Active owner of organization B and workspace B. */
  userB: "a0000000-0000-4000-8000-000000000032",
  /** Member of organizations A and B, but only of workspace A. */
  userMultiOrg: "a0000000-0000-4000-8000-000000000033",
  /** Member of organization A only: proves company -> workspace inheritance is off. */
  userOrgOnly: "a0000000-0000-4000-8000-000000000034",
  /** Workspace A membership revoked (status inactive). */
  userRevoked: "a0000000-0000-4000-8000-000000000035",
  /** Active memberships, but the identity itself is blocked. */
  userBlocked: "a0000000-0000-4000-8000-000000000036",
} as const;

export const contextA = {
  userId: ids.userA,
  workspaceId: ids.workspaceA,
  organizationId: ids.organizationA,
} as const;

export const contextB = {
  userId: ids.userB,
  workspaceId: ids.workspaceB,
  organizationId: ids.organizationB,
} as const;

/** Multi-organization user operating inside organization/workspace A. */
export const contextMultiOrgInA = {
  userId: ids.userMultiOrg,
  workspaceId: ids.workspaceA,
  organizationId: ids.organizationA,
} as const;

/** Organization-only member pointed at workspace A (must see nothing). */
export const contextOrgOnly = {
  userId: ids.userOrgOnly,
  workspaceId: ids.workspaceA,
  organizationId: ids.organizationA,
} as const;

/** Revoked workspace membership pointed at workspace A (must see nothing). */
export const contextRevoked = {
  userId: ids.userRevoked,
  workspaceId: ids.workspaceA,
  organizationId: ids.organizationA,
} as const;

/** Blocked identity with otherwise valid memberships. */
export const contextBlocked = {
  userId: ids.userBlocked,
  workspaceId: ids.workspaceA,
  organizationId: ids.organizationA,
} as const;
