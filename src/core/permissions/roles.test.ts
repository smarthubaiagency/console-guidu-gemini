import { describe, expect, it } from "vitest";

import {
  canAssignWorkspaceRole,
  canManageWorkspaceMember,
  isWorkspaceRole,
  OrganizationRoles,
  WorkspaceRoles,
  WS_ROLE_RANK,
} from "./roles";

describe("workspace roles: Attendant (AT1)", () => {
  it("is a workspace role and the lowest rank", () => {
    expect(isWorkspaceRole("attendant")).toBe(true);
    expect(isWorkspaceRole("agent")).toBe(false);
    const ranks = Object.values(WS_ROLE_RANK);
    expect(WS_ROLE_RANK[WorkspaceRoles.ATTENDANT]).toBe(Math.min(...ranks));
  });

  it("is assigned by owners and admins", () => {
    expect(
      canAssignWorkspaceRole(undefined, WorkspaceRoles.OWNER, "attendant"),
    ).toBe(true);
    expect(
      canAssignWorkspaceRole(undefined, WorkspaceRoles.ADMIN, "attendant"),
    ).toBe(true);
    expect(
      canAssignWorkspaceRole(OrganizationRoles.OWNER, undefined, "attendant"),
    ).toBe(true);
    expect(
      canAssignWorkspaceRole(undefined, WorkspaceRoles.EDITOR, "attendant"),
    ).toBe(false);
    expect(
      canAssignWorkspaceRole(undefined, WorkspaceRoles.VIEWER, "attendant"),
    ).toBe(false);
  });

  it("invites, promotes and manages no one", () => {
    for (const target of Object.values(WorkspaceRoles)) {
      expect(
        canAssignWorkspaceRole(
          OrganizationRoles.MEMBER,
          WorkspaceRoles.ATTENDANT,
          target,
        ),
      ).toBe(false);
      expect(
        canManageWorkspaceMember(
          OrganizationRoles.MEMBER,
          WorkspaceRoles.ATTENDANT,
          target,
        ),
      ).toBe(false);
    }
  });

  it("is managed by admins but an admin still cannot touch owners", () => {
    expect(
      canManageWorkspaceMember(undefined, WorkspaceRoles.ADMIN, "attendant"),
    ).toBe(true);
    expect(
      canAssignWorkspaceRole(undefined, WorkspaceRoles.ADMIN, "owner"),
    ).toBe(false);
  });
});
