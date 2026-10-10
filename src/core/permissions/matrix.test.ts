import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, Permission, Permissions } from "./catalog";
import {
  hasOrganizationRolePermission,
  hasWorkspaceRolePermission,
  ORGANIZATION_ROLE_PERMISSIONS,
  WORKSPACE_ROLE_PERMISSIONS,
} from "./matrix";
import {
  OrganizationRole,
  OrganizationRoles,
  WorkspaceRole,
  WorkspaceRoles,
} from "./roles";

describe("Permissions Matrix", () => {
  describe("WorkspaceRole matrix", () => {
    const workspaceRoles = Object.values(WorkspaceRoles);
    const allPermissions = Array.from(ALL_PERMISSIONS);

    // Explicit expectation mapping for every workspace role
    const expectedWorkspacePermissions: Record<
      WorkspaceRole,
      Record<Permission, boolean>
    > = {
      [WorkspaceRoles.OWNER]: {
        [Permissions.WORKSPACE_READ]: true,
        [Permissions.WORKSPACE_SETTINGS_UPDATE]: true,
        [Permissions.WORKSPACE_MEMBERS_READ]: true,
        [Permissions.WORKSPACE_MEMBERS_INVITE]: true,
        [Permissions.WORKSPACE_MEMBERS_MANAGE]: true,
        [Permissions.WORKSPACE_MODULES_MANAGE]: true,
        [Permissions.PLATFORM_MODULES_READ]: false,
        [Permissions.PLATFORM_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_BRAND_MANAGE]: false,
        [Permissions.PLATFORM_PARTNERS_READ]: false,
        [Permissions.PLATFORM_PARTNERS_MANAGE]: false,
        [Permissions.PARTNER_READ]: false,
        [Permissions.PARTNER_CUSTOMERS_READ]: false,
        [Permissions.PARTNER_MEMBERS_MANAGE]: false,
        [Permissions.PARTNER_BRAND_MANAGE]: false,
        [Permissions.PARTNER_CUSTOMERS_MANAGE]: false,
        [Permissions.PLATFORM_LEGAL_MANAGE]: false,
        [Permissions.PARTNER_LEGAL_MANAGE]: false,
        [Permissions.PLATFORM_BILLING_READ]: false,
        [Permissions.PLATFORM_BILLING_MANAGE]: false,
        [Permissions.PLATFORM_OPERATIONS_READ]: false,
        [Permissions.PARTNER_BILLING_READ]: false,
        [Permissions.PARTNER_BILLING_MANAGE]: false,
        [Permissions.PARTNER_SUPPORT_REQUEST]: false,
        [Permissions.CREDENTIALS_READ]: true,
        [Permissions.CREDENTIALS_MANAGE]: true,
        [Permissions.API_KEYS_CREATE_OWN]: true,
        [Permissions.API_KEYS_REVOKE_OWN]: true,
        [Permissions.API_KEYS_REVOKE_ANY]: true,
        [Permissions.API_KEYS_READ_ALL]: true,
        [Permissions.AI_AGENTS_USE]: true,
        [Permissions.AI_AGENTS_MANAGE]: true,
        [Permissions.ORGANIZATION_READ]: false,
        [Permissions.ORGANIZATION_MEMBERS_INVITE]: false,
        [Permissions.ORGANIZATION_MEMBERS_MANAGE]: false,
        [Permissions.ORGANIZATION_SETTINGS_UPDATE]: false,
      },
      [WorkspaceRoles.ADMIN]: {
        [Permissions.WORKSPACE_READ]: true,
        [Permissions.WORKSPACE_SETTINGS_UPDATE]: true,
        [Permissions.WORKSPACE_MEMBERS_READ]: true,
        [Permissions.WORKSPACE_MEMBERS_INVITE]: true,
        [Permissions.WORKSPACE_MEMBERS_MANAGE]: true,
        [Permissions.WORKSPACE_MODULES_MANAGE]: true,
        [Permissions.PLATFORM_MODULES_READ]: false,
        [Permissions.PLATFORM_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_BRAND_MANAGE]: false,
        [Permissions.PLATFORM_PARTNERS_READ]: false,
        [Permissions.PLATFORM_PARTNERS_MANAGE]: false,
        [Permissions.PARTNER_READ]: false,
        [Permissions.PARTNER_CUSTOMERS_READ]: false,
        [Permissions.PARTNER_MEMBERS_MANAGE]: false,
        [Permissions.PARTNER_BRAND_MANAGE]: false,
        [Permissions.PARTNER_CUSTOMERS_MANAGE]: false,
        [Permissions.PLATFORM_LEGAL_MANAGE]: false,
        [Permissions.PARTNER_LEGAL_MANAGE]: false,
        [Permissions.PLATFORM_BILLING_READ]: false,
        [Permissions.PLATFORM_BILLING_MANAGE]: false,
        [Permissions.PLATFORM_OPERATIONS_READ]: false,
        [Permissions.PARTNER_BILLING_READ]: false,
        [Permissions.PARTNER_BILLING_MANAGE]: false,
        [Permissions.PARTNER_SUPPORT_REQUEST]: false,
        [Permissions.CREDENTIALS_READ]: true,
        [Permissions.CREDENTIALS_MANAGE]: true,
        [Permissions.API_KEYS_CREATE_OWN]: true,
        [Permissions.API_KEYS_REVOKE_OWN]: true,
        [Permissions.API_KEYS_REVOKE_ANY]: true,
        [Permissions.API_KEYS_READ_ALL]: true,
        [Permissions.AI_AGENTS_USE]: true,
        [Permissions.AI_AGENTS_MANAGE]: true,
        [Permissions.ORGANIZATION_READ]: false,
        [Permissions.ORGANIZATION_MEMBERS_INVITE]: false,
        [Permissions.ORGANIZATION_MEMBERS_MANAGE]: false,
        [Permissions.ORGANIZATION_SETTINGS_UPDATE]: false,
      },
      [WorkspaceRoles.EDITOR]: {
        [Permissions.WORKSPACE_READ]: true,
        [Permissions.WORKSPACE_SETTINGS_UPDATE]: false,
        [Permissions.WORKSPACE_MEMBERS_READ]: true,
        [Permissions.WORKSPACE_MEMBERS_INVITE]: false,
        [Permissions.WORKSPACE_MEMBERS_MANAGE]: false,
        [Permissions.WORKSPACE_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_MODULES_READ]: false,
        [Permissions.PLATFORM_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_BRAND_MANAGE]: false,
        [Permissions.PLATFORM_PARTNERS_READ]: false,
        [Permissions.PLATFORM_PARTNERS_MANAGE]: false,
        [Permissions.PARTNER_READ]: false,
        [Permissions.PARTNER_CUSTOMERS_READ]: false,
        [Permissions.PARTNER_MEMBERS_MANAGE]: false,
        [Permissions.PARTNER_BRAND_MANAGE]: false,
        [Permissions.PARTNER_CUSTOMERS_MANAGE]: false,
        [Permissions.PLATFORM_LEGAL_MANAGE]: false,
        [Permissions.PARTNER_LEGAL_MANAGE]: false,
        [Permissions.PLATFORM_BILLING_READ]: false,
        [Permissions.PLATFORM_BILLING_MANAGE]: false,
        [Permissions.PLATFORM_OPERATIONS_READ]: false,
        [Permissions.PARTNER_BILLING_READ]: false,
        [Permissions.PARTNER_BILLING_MANAGE]: false,
        [Permissions.PARTNER_SUPPORT_REQUEST]: false,
        [Permissions.CREDENTIALS_READ]: true,
        [Permissions.CREDENTIALS_MANAGE]: false,
        [Permissions.API_KEYS_CREATE_OWN]: true,
        [Permissions.API_KEYS_REVOKE_OWN]: true,
        [Permissions.API_KEYS_REVOKE_ANY]: false,
        [Permissions.API_KEYS_READ_ALL]: false,
        [Permissions.AI_AGENTS_USE]: true,
        [Permissions.AI_AGENTS_MANAGE]: false,
        [Permissions.ORGANIZATION_READ]: false,
        [Permissions.ORGANIZATION_MEMBERS_INVITE]: false,
        [Permissions.ORGANIZATION_MEMBERS_MANAGE]: false,
        [Permissions.ORGANIZATION_SETTINGS_UPDATE]: false,
      },
      [WorkspaceRoles.VIEWER]: {
        [Permissions.WORKSPACE_READ]: true,
        [Permissions.WORKSPACE_SETTINGS_UPDATE]: false,
        [Permissions.WORKSPACE_MEMBERS_READ]: true,
        [Permissions.WORKSPACE_MEMBERS_INVITE]: false,
        [Permissions.WORKSPACE_MEMBERS_MANAGE]: false,
        [Permissions.WORKSPACE_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_MODULES_READ]: false,
        [Permissions.PLATFORM_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_BRAND_MANAGE]: false,
        [Permissions.PLATFORM_PARTNERS_READ]: false,
        [Permissions.PLATFORM_PARTNERS_MANAGE]: false,
        [Permissions.PARTNER_READ]: false,
        [Permissions.PARTNER_CUSTOMERS_READ]: false,
        [Permissions.PARTNER_MEMBERS_MANAGE]: false,
        [Permissions.PARTNER_BRAND_MANAGE]: false,
        [Permissions.PARTNER_CUSTOMERS_MANAGE]: false,
        [Permissions.PLATFORM_LEGAL_MANAGE]: false,
        [Permissions.PARTNER_LEGAL_MANAGE]: false,
        [Permissions.PLATFORM_BILLING_READ]: false,
        [Permissions.PLATFORM_BILLING_MANAGE]: false,
        [Permissions.PLATFORM_OPERATIONS_READ]: false,
        [Permissions.PARTNER_BILLING_READ]: false,
        [Permissions.PARTNER_BILLING_MANAGE]: false,
        [Permissions.PARTNER_SUPPORT_REQUEST]: false,
        [Permissions.CREDENTIALS_READ]: false,
        [Permissions.CREDENTIALS_MANAGE]: false,
        [Permissions.API_KEYS_CREATE_OWN]: true,
        [Permissions.API_KEYS_REVOKE_OWN]: true,
        [Permissions.API_KEYS_REVOKE_ANY]: false,
        [Permissions.API_KEYS_READ_ALL]: false,
        [Permissions.AI_AGENTS_USE]: false,
        [Permissions.AI_AGENTS_MANAGE]: false,
        [Permissions.ORGANIZATION_READ]: false,
        [Permissions.ORGANIZATION_MEMBERS_INVITE]: false,
        [Permissions.ORGANIZATION_MEMBERS_MANAGE]: false,
        [Permissions.ORGANIZATION_SETTINGS_UPDATE]: false,
      },
    };

    const workspaceTestCases: Array<[WorkspaceRole, Permission, boolean]> = [];
    for (const role of workspaceRoles) {
      for (const permission of allPermissions) {
        workspaceTestCases.push([
          role,
          permission,
          expectedWorkspacePermissions[role][permission],
        ]);
      }
    }

    it.each(workspaceTestCases)(
      "hasWorkspaceRolePermission(%s, %s) -> %s",
      (role, permission, expected) => {
        expect(hasWorkspaceRolePermission(role, permission)).toBe(expected);
      },
    );

    it("matches exact count of permissions declared in WORKSPACE_ROLE_PERMISSIONS", () => {
      expect(WORKSPACE_ROLE_PERMISSIONS[WorkspaceRoles.OWNER].size).toBe(14);
      expect(WORKSPACE_ROLE_PERMISSIONS[WorkspaceRoles.ADMIN].size).toBe(14);
      expect(WORKSPACE_ROLE_PERMISSIONS[WorkspaceRoles.EDITOR].size).toBe(6);
      expect(WORKSPACE_ROLE_PERMISSIONS[WorkspaceRoles.VIEWER].size).toBe(4);
    });
  });

  describe("OrganizationRole matrix", () => {
    const orgRoles = Object.values(OrganizationRoles);
    const allPermissions = Array.from(ALL_PERMISSIONS);

    const expectedOrgPermissions: Record<
      OrganizationRole,
      Record<Permission, boolean>
    > = {
      [OrganizationRoles.OWNER]: {
        [Permissions.WORKSPACE_READ]: false,
        [Permissions.WORKSPACE_SETTINGS_UPDATE]: false,
        [Permissions.WORKSPACE_MEMBERS_READ]: false,
        [Permissions.WORKSPACE_MEMBERS_INVITE]: false,
        [Permissions.WORKSPACE_MEMBERS_MANAGE]: false,
        [Permissions.WORKSPACE_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_MODULES_READ]: false,
        [Permissions.PLATFORM_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_BRAND_MANAGE]: false,
        [Permissions.PLATFORM_PARTNERS_READ]: false,
        [Permissions.PLATFORM_PARTNERS_MANAGE]: false,
        [Permissions.PARTNER_READ]: false,
        [Permissions.PARTNER_CUSTOMERS_READ]: false,
        [Permissions.PARTNER_MEMBERS_MANAGE]: false,
        [Permissions.PARTNER_BRAND_MANAGE]: false,
        [Permissions.PARTNER_CUSTOMERS_MANAGE]: false,
        [Permissions.PLATFORM_LEGAL_MANAGE]: false,
        [Permissions.PARTNER_LEGAL_MANAGE]: false,
        [Permissions.PLATFORM_BILLING_READ]: false,
        [Permissions.PLATFORM_BILLING_MANAGE]: false,
        [Permissions.PLATFORM_OPERATIONS_READ]: false,
        [Permissions.PARTNER_BILLING_READ]: false,
        [Permissions.PARTNER_BILLING_MANAGE]: false,
        [Permissions.PARTNER_SUPPORT_REQUEST]: false,
        [Permissions.CREDENTIALS_READ]: false,
        [Permissions.CREDENTIALS_MANAGE]: false,
        [Permissions.API_KEYS_CREATE_OWN]: false,
        [Permissions.API_KEYS_REVOKE_OWN]: false,
        [Permissions.API_KEYS_REVOKE_ANY]: false,
        [Permissions.API_KEYS_READ_ALL]: false,
        [Permissions.AI_AGENTS_USE]: false,
        [Permissions.AI_AGENTS_MANAGE]: false,
        [Permissions.ORGANIZATION_READ]: true,
        [Permissions.ORGANIZATION_MEMBERS_INVITE]: true,
        [Permissions.ORGANIZATION_MEMBERS_MANAGE]: true,
        [Permissions.ORGANIZATION_SETTINGS_UPDATE]: true,
      },
      [OrganizationRoles.ADMIN]: {
        [Permissions.WORKSPACE_READ]: false,
        [Permissions.WORKSPACE_SETTINGS_UPDATE]: false,
        [Permissions.WORKSPACE_MEMBERS_READ]: false,
        [Permissions.WORKSPACE_MEMBERS_INVITE]: false,
        [Permissions.WORKSPACE_MEMBERS_MANAGE]: false,
        [Permissions.WORKSPACE_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_MODULES_READ]: false,
        [Permissions.PLATFORM_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_BRAND_MANAGE]: false,
        [Permissions.PLATFORM_PARTNERS_READ]: false,
        [Permissions.PLATFORM_PARTNERS_MANAGE]: false,
        [Permissions.PARTNER_READ]: false,
        [Permissions.PARTNER_CUSTOMERS_READ]: false,
        [Permissions.PARTNER_MEMBERS_MANAGE]: false,
        [Permissions.PARTNER_BRAND_MANAGE]: false,
        [Permissions.PARTNER_CUSTOMERS_MANAGE]: false,
        [Permissions.PLATFORM_LEGAL_MANAGE]: false,
        [Permissions.PARTNER_LEGAL_MANAGE]: false,
        [Permissions.PLATFORM_BILLING_READ]: false,
        [Permissions.PLATFORM_BILLING_MANAGE]: false,
        [Permissions.PLATFORM_OPERATIONS_READ]: false,
        [Permissions.PARTNER_BILLING_READ]: false,
        [Permissions.PARTNER_BILLING_MANAGE]: false,
        [Permissions.PARTNER_SUPPORT_REQUEST]: false,
        [Permissions.CREDENTIALS_READ]: false,
        [Permissions.CREDENTIALS_MANAGE]: false,
        [Permissions.API_KEYS_CREATE_OWN]: false,
        [Permissions.API_KEYS_REVOKE_OWN]: false,
        [Permissions.API_KEYS_REVOKE_ANY]: false,
        [Permissions.API_KEYS_READ_ALL]: false,
        [Permissions.AI_AGENTS_USE]: false,
        [Permissions.AI_AGENTS_MANAGE]: false,
        [Permissions.ORGANIZATION_READ]: true,
        [Permissions.ORGANIZATION_MEMBERS_INVITE]: true,
        [Permissions.ORGANIZATION_MEMBERS_MANAGE]: true,
        [Permissions.ORGANIZATION_SETTINGS_UPDATE]: true,
      },
      [OrganizationRoles.MEMBER]: {
        [Permissions.WORKSPACE_READ]: false,
        [Permissions.WORKSPACE_SETTINGS_UPDATE]: false,
        [Permissions.WORKSPACE_MEMBERS_READ]: false,
        [Permissions.WORKSPACE_MEMBERS_INVITE]: false,
        [Permissions.WORKSPACE_MEMBERS_MANAGE]: false,
        [Permissions.WORKSPACE_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_MODULES_READ]: false,
        [Permissions.PLATFORM_MODULES_MANAGE]: false,
        [Permissions.PLATFORM_BRAND_MANAGE]: false,
        [Permissions.PLATFORM_PARTNERS_READ]: false,
        [Permissions.PLATFORM_PARTNERS_MANAGE]: false,
        [Permissions.PARTNER_READ]: false,
        [Permissions.PARTNER_CUSTOMERS_READ]: false,
        [Permissions.PARTNER_MEMBERS_MANAGE]: false,
        [Permissions.PARTNER_BRAND_MANAGE]: false,
        [Permissions.PARTNER_CUSTOMERS_MANAGE]: false,
        [Permissions.PLATFORM_LEGAL_MANAGE]: false,
        [Permissions.PARTNER_LEGAL_MANAGE]: false,
        [Permissions.PLATFORM_BILLING_READ]: false,
        [Permissions.PLATFORM_BILLING_MANAGE]: false,
        [Permissions.PLATFORM_OPERATIONS_READ]: false,
        [Permissions.PARTNER_BILLING_READ]: false,
        [Permissions.PARTNER_BILLING_MANAGE]: false,
        [Permissions.PARTNER_SUPPORT_REQUEST]: false,
        [Permissions.CREDENTIALS_READ]: false,
        [Permissions.CREDENTIALS_MANAGE]: false,
        [Permissions.API_KEYS_CREATE_OWN]: false,
        [Permissions.API_KEYS_REVOKE_OWN]: false,
        [Permissions.API_KEYS_REVOKE_ANY]: false,
        [Permissions.API_KEYS_READ_ALL]: false,
        [Permissions.AI_AGENTS_USE]: false,
        [Permissions.AI_AGENTS_MANAGE]: false,
        [Permissions.ORGANIZATION_READ]: true,
        [Permissions.ORGANIZATION_MEMBERS_INVITE]: false,
        [Permissions.ORGANIZATION_MEMBERS_MANAGE]: false,
        [Permissions.ORGANIZATION_SETTINGS_UPDATE]: false,
      },
    };

    const orgTestCases: Array<[OrganizationRole, Permission, boolean]> = [];
    for (const role of orgRoles) {
      for (const permission of allPermissions) {
        orgTestCases.push([
          role,
          permission,
          expectedOrgPermissions[role][permission],
        ]);
      }
    }

    it.each(orgTestCases)(
      "hasOrganizationRolePermission(%s, %s) -> %s",
      (role, permission, expected) => {
        expect(hasOrganizationRolePermission(role, permission)).toBe(expected);
      },
    );

    it("matches exact count of permissions declared in ORGANIZATION_ROLE_PERMISSIONS", () => {
      expect(ORGANIZATION_ROLE_PERMISSIONS[OrganizationRoles.OWNER].size).toBe(
        4,
      );
      expect(ORGANIZATION_ROLE_PERMISSIONS[OrganizationRoles.ADMIN].size).toBe(
        4,
      );
      expect(ORGANIZATION_ROLE_PERMISSIONS[OrganizationRoles.MEMBER].size).toBe(
        1,
      );
    });
  });
});
