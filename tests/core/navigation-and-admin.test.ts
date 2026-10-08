import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { listUserWorkspaces } from "@/core/workspaces/navigation";
import {
  getPlatformAdminMember,
  requirePlatformAdmin,
  getAdminMetrics,
  listAdminOrganizations,
  listAdminWorkspaces,
  listAdminUsers,
  PlatformAdminAccessDeniedError,
} from "@/core/admin/platform";
import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const requiredVars = { DATABASE_URL: databaseUrl };

/**
 * Automated test suite for Task 05:
 * 1. User workspace resolution and navigation.
 * 2. Multi-tenant workspace enumeration boundary (only active memberships).
 * 3. Platform administration authorization and operations.
 */
describeDatabase("Task 05: Workspace Navigation & Platform Administration", requiredVars, () => {
  const databaseUrl =
    process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  const adminUserId = "d0000000-0000-4000-8000-000000000003";

  describe("Workspace Navigation (listUserWorkspaces)", () => {
    it("returns active workspaces with organization metadata for an active member", async () => {
      const workspaces = await listUserWorkspaces(prisma, ids.userA);

      expect(workspaces.length).toBeGreaterThanOrEqual(1);
      const wsA = workspaces.find((w) => w.workspaceSlug === "workspace-a");
      expect(wsA).toBeDefined();
      expect(wsA?.workspaceName).toBe("Workspace A");
      expect(wsA?.organizationName).toBe("Organization A");
      expect(wsA?.workspaceRole).toBe("owner");
      expect(wsA?.workspaceStatus).toBe("active");
    });

    it("does not expose workspaces of other organizations (AC01 isolation)", async () => {
      const workspaces = await listUserWorkspaces(prisma, ids.userA);

      // User A belongs only to Workspace A / Org A, never Workspace B / Org B
      const wsB = workspaces.find((w) => w.workspaceSlug === "workspace-b");
      expect(wsB).toBeUndefined();
    });

    it("returns zero workspaces for a user whose workspace membership is revoked (AC03)", async () => {
      const workspaces = await listUserWorkspaces(prisma, ids.userRevoked);

      const wsA = workspaces.find((w) => w.workspaceSlug === "workspace-a");
      expect(wsA).toBeUndefined();
    });

    it("returns zero workspaces for an organization-only member (inheritance off)", async () => {
      const workspaces = await listUserWorkspaces(prisma, ids.userOrgOnly);

      expect(workspaces).toEqual([]);
    });
  });

  describe("Platform Administration Guard & Role Checks", () => {
    it("returns null when checking platform admin for a standard tenant user", async () => {
      const adminInfo = await getPlatformAdminMember(prisma, ids.userA);
      expect(adminInfo).toBeNull();
    });

    it("throws PlatformAdminAccessDeniedError when a tenant user calls requirePlatformAdmin", async () => {
      await expect(requirePlatformAdmin(prisma, ids.userA)).rejects.toThrow(
        PlatformAdminAccessDeniedError,
      );
    });

    it("identifies a valid active platform administrator", async () => {
      const adminInfo = await getPlatformAdminMember(prisma, adminUserId);
      expect(adminInfo).not.toBeNull();
      expect(adminInfo?.userId).toBe(adminUserId);
      expect(adminInfo?.role).toBe("owner");
      expect(adminInfo?.status).toBe("active");
    });

    it("successfully passes requirePlatformAdmin for an active operator", async () => {
      const adminInfo = await requirePlatformAdmin(prisma, adminUserId);
      expect(adminInfo.role).toBe("owner");
    });
  });

  describe("Platform Administration Data Queries (Metrics, Orgs, Workspaces, Users)", () => {
    it("denies metric computation to a non-admin caller at database level", async () => {
      await expect(getAdminMetrics(prisma, ids.userA)).rejects.toThrow();
    });

    it("computes real platform metrics for an active administrator", async () => {
      const metrics = await getAdminMetrics(prisma, adminUserId);

      expect(metrics).toBeDefined();
      expect(metrics.totalOrganizations).toBeGreaterThanOrEqual(2);
      expect(metrics.totalWorkspaces).toBeGreaterThanOrEqual(2);
      expect(metrics.totalUsers).toBeGreaterThanOrEqual(2);
    });

    it("denies organization listing to a non-admin caller at database level", async () => {
      await expect(listAdminOrganizations(prisma, ids.userA)).rejects.toThrow();
    });

    it("lists organizations for an active platform administrator", async () => {
      const orgs = await listAdminOrganizations(prisma, adminUserId);

      expect(orgs.length).toBeGreaterThanOrEqual(2);
      const orgA = orgs.find((o) => o.name === "Organization A");
      expect(orgA).toBeDefined();
      expect(orgA?.status).toBe("active");
      expect(orgA?.maxSeats).toBeGreaterThanOrEqual(1);
    });

    it("lists workspaces across tenants for an active platform administrator", async () => {
      const workspaces = await listAdminWorkspaces(prisma, adminUserId);

      expect(workspaces.length).toBeGreaterThanOrEqual(2);
      const wsA = workspaces.find((w) => w.slug === "workspace-a");
      const wsB = workspaces.find((w) => w.slug === "workspace-b");
      expect(wsA).toBeDefined();
      expect(wsB).toBeDefined();
      expect(wsA?.organizationName).toBe("Organization A");
      expect(wsB?.organizationName).toBe("Organization B");
    });

    it("lists users across the platform for an active platform administrator", async () => {
      const users = await listAdminUsers(prisma, adminUserId);

      expect(users.length).toBeGreaterThanOrEqual(2);
      const userA = users.find((u) => u.id === ids.userA);
      expect(userA).toBeDefined();
      expect(userA?.fullName).toBe("User A");
      expect(userA?.status).toBe("active");
    });
  });
});
