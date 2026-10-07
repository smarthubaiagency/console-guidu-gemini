export const ids = {
  organizationA: "10000000-0000-4000-8000-000000000001",
  organizationB: "20000000-0000-4000-8000-000000000001",
  workspaceA: "10000000-0000-4000-8000-000000000002",
  workspaceB: "20000000-0000-4000-8000-000000000002",
  userA: "10000000-0000-4000-8000-000000000003",
  userB: "20000000-0000-4000-8000-000000000003",
  noteA: "10000000-0000-4000-8000-000000000004",
  noteB: "20000000-0000-4000-8000-000000000004",
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

