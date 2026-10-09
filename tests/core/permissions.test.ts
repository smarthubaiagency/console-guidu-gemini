/**
 * ============================================================================
 * File: tests/core/permissions.test.ts
 * Module: Permissions Guard & Server-Side Enforcement Integration Tests (C06)
 *
 * Maintenance Rationale:
 * - Validates Specification Section 7, Section 25 & AC03:
 *   1. Viewer is strictly denied privileged operations (e.g., workspace.members.invite).
 *   2. Admin is permitted to invite workspace members.
 *   3. Inactive membership is denied immediately even when role is owner.
 *   4. User from another workspace / without membership is rejected with PermissionDeniedError.
 *   5. Organization permission guard enforces organization matrix.
 * ============================================================================
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Permissions } from "../../src/core/permissions/catalog";
import {
  PermissionDeniedError,
  requireOrganizationPermission,
  requireWorkspacePermission,
} from "../../src/core/permissions/guard";
import { withContext } from "../../src/lib/prisma/with-context";
import { describeDatabase } from "../prisma-rls/describe-database";

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;
const requiredVars = { DATABASE_URL: pooledUrl, DIRECT_DATABASE_URL: directUrl };

// Synthetic fixtures defined in tests/core/membership-seed.sql
const fixtures = {
  orgId: "d0000000-0000-4000-8000-000000000100",
  workspaceId: "d0000000-0000-4000-8000-000000000200",
  ownerId: "d0000000-0000-4000-8000-000000000001",
  adminId: "d0000000-0000-4000-8000-000000000002",
  viewerId: "d0000000-0000-4000-8000-000000000003",
  inactiveUserId: "d0000000-0000-4000-8000-000000000004",
  foreignUserId: "d0000000-0000-4000-8000-000000000005",
} as const;

const ownerContext = {
  userId: fixtures.ownerId,
  organizationId: fixtures.orgId,
  workspaceId: fixtures.workspaceId,
};

describeDatabase("core permissions guard integration (C06)", requiredVars, () => {
  const prisma = new PrismaClient({ datasourceUrl: pooledUrl! });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Reset test memberships to known state
    await withContext(prisma, ownerContext, async (tx) => {
      // Clean up auxiliary memberships
      await tx.workspaceMember.deleteMany({
        where: {
          workspaceId: fixtures.workspaceId,
          userId: { not: fixtures.ownerId },
        },
      });
      await tx.organizationMember.deleteMany({
        where: {
          organizationId: fixtures.orgId,
          userId: { not: fixtures.ownerId },
        },
      });

      // 1. Admin user in org & workspace
      await tx.organizationMember.create({
        data: {
          organizationId: fixtures.orgId,
          userId: fixtures.adminId,
          role: "admin",
          status: "active",
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: fixtures.workspaceId,
          organizationId: fixtures.orgId,
          userId: fixtures.adminId,
          role: "admin",
          status: "active",
        },
      });

      // 2. Viewer user in org & workspace
      await tx.organizationMember.create({
        data: {
          organizationId: fixtures.orgId,
          userId: fixtures.viewerId,
          role: "member",
          status: "active",
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: fixtures.workspaceId,
          organizationId: fixtures.orgId,
          userId: fixtures.viewerId,
          role: "viewer",
          status: "active",
        },
      });

      // 3. Inactive owner user in workspace
      await tx.organizationMember.create({
        data: {
          organizationId: fixtures.orgId,
          userId: fixtures.inactiveUserId,
          role: "member",
          status: "active",
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: fixtures.workspaceId,
          organizationId: fixtures.orgId,
          userId: fixtures.inactiveUserId,
          role: "owner",
          status: "inactive",
        },
      });
    });
  });

  describe("requireWorkspacePermission", () => {
    it("viewer negado em workspace.members.invite", async () => {
      const viewerContext = {
        userId: fixtures.viewerId,
        organizationId: fixtures.orgId,
        workspaceId: fixtures.workspaceId,
      };

      await withContext(prisma, viewerContext, async (tx) => {
        await expect(
          requireWorkspacePermission(
            tx,
            viewerContext,
            Permissions.WORKSPACE_MEMBERS_INVITE,
          ),
        ).rejects.toThrow(PermissionDeniedError);
      });
    });

    it("admin permitido em workspace.members.invite", async () => {
      const adminContext = {
        userId: fixtures.adminId,
        organizationId: fixtures.orgId,
        workspaceId: fixtures.workspaceId,
      };

      await withContext(prisma, adminContext, async (tx) => {
        const result = await requireWorkspacePermission(
          tx,
          adminContext,
          Permissions.WORKSPACE_MEMBERS_INVITE,
        );

        expect(result.workspaceRole).toBe("admin");
        expect(result.organizationRole).toBe("admin");
      });
    });

    it("vínculo inactive negado mesmo com papel owner", async () => {
      const inactiveContext = {
        userId: fixtures.inactiveUserId,
        organizationId: fixtures.orgId,
        workspaceId: fixtures.workspaceId,
      };

      await withContext(prisma, inactiveContext, async (tx) => {
        await expect(
          requireWorkspacePermission(
            tx,
            inactiveContext,
            Permissions.WORKSPACE_READ,
          ),
        ).rejects.toThrow(PermissionDeniedError);
      });
    });

    it("usuário de outro workspace negado", async () => {
      const foreignContext = {
        userId: fixtures.foreignUserId,
        organizationId: fixtures.orgId,
        workspaceId: fixtures.workspaceId,
      };

      await withContext(prisma, foreignContext, async (tx) => {
        await expect(
          requireWorkspacePermission(
            tx,
            foreignContext,
            Permissions.WORKSPACE_READ,
          ),
        ).rejects.toThrow(PermissionDeniedError);
      });
    });
  });

  describe("requireOrganizationPermission", () => {
    it("membro comum da organização negado em organization.members.invite", async () => {
      const memberContext = {
        userId: fixtures.viewerId,
        organizationId: fixtures.orgId,
        workspaceId: fixtures.workspaceId,
      };

      await withContext(prisma, memberContext, async (tx) => {
        await expect(
          requireOrganizationPermission(
            tx,
            memberContext,
            Permissions.ORGANIZATION_MEMBERS_INVITE,
          ),
        ).rejects.toThrow(PermissionDeniedError);
      });
    });

    it("admin da organização permitido em organization.members.invite", async () => {
      const adminContext = {
        userId: fixtures.adminId,
        organizationId: fixtures.orgId,
        workspaceId: fixtures.workspaceId,
      };

      await withContext(prisma, adminContext, async (tx) => {
        const result = await requireOrganizationPermission(
          tx,
          adminContext,
          Permissions.ORGANIZATION_MEMBERS_INVITE,
        );

        expect(result.organizationRole).toBe("admin");
      });
    });
  });
});
