import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveWorkspaceContext } from "../../src/core/auth/context.js";
import { HOUSE_PARTNER_ID } from "../../src/core/partners/constants.js";
import { withContext } from "../../src/lib/prisma/with-context.js";
import {
  contextA,
  contextB,
  contextBlocked,
  contextMultiOrgInA,
  contextOrgOnly,
  contextRevoked,
  ids,
} from "./fixtures.js";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;
const requiredVars = { DATABASE_URL: pooledUrl, DIRECT_DATABASE_URL: directUrl };

type RuntimeIdentity = {
  current_user: string;
  rolbypassrls: boolean;
};

describeDatabase("core identity RLS isolation through Prisma", requiredVars, () => {
  const pooled = new PrismaClient({ datasourceUrl: pooledUrl! });
  const direct = new PrismaClient({ datasourceUrl: directUrl! });

  beforeAll(async () => {
    await Promise.all([pooled.$connect(), direct.$connect()]);

    const [pooledIdentity, directIdentity] = await Promise.all([
      pooled.$queryRaw<RuntimeIdentity[]>`
        select current_user, rolbypassrls
        from pg_roles
        where rolname = current_user
      `,
      direct.$queryRaw<RuntimeIdentity[]>`
        select current_user, rolbypassrls
        from pg_roles
        where rolname = current_user
      `,
    ]);
    expect(pooledIdentity[0]).toEqual({ current_user: "app_runtime", rolbypassrls: false });
    expect(directIdentity[0]).toEqual({ current_user: "app_runtime", rolbypassrls: false });
  });

  afterAll(async () => {
    await Promise.all([pooled.$disconnect(), direct.$disconnect()]);
  });

  it("reads only the active workspace organizations", async () => {
    const rows = await withContext(pooled, contextA, (tx) =>
      tx.organization.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([ids.organizationA]);
  });

  it("reads only the active workspace", async () => {
    const rows = await withContext(pooled, contextA, (tx) =>
      tx.workspace.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([ids.workspaceA]);
  });

  // ================================================================
  // AC01: cross-workspace isolation
  // ================================================================

  it("denies cross-workspace reads (AC01)", async () => {
    const visible = await withContext(pooled, contextA, (tx) =>
      tx.organization.findUnique({ where: { id: ids.organizationB } }),
    );
    expect(visible).toBeNull();

    const workspaceVisible = await withContext(pooled, contextA, (tx) =>
      tx.workspace.findUnique({ where: { id: ids.workspaceB } }),
    );
    expect(workspaceVisible).toBeNull();
  });

  it("denies cross-workspace member reads (AC01)", async () => {
    const membersA = await withContext(pooled, contextA, (tx) =>
      tx.workspaceMember.findMany(),
    );
    // Workspace A contains the active owner, multi-org member, revoked member and blocked identity
    expect(membersA.map((m) => m.userId).sort()).toEqual(
      [ids.userA, ids.userMultiOrg, ids.userRevoked, ids.userBlocked].sort(),
    );
    expect(membersA.map((m) => m.userId)).not.toContain(ids.userB);

    const membersB = await withContext(pooled, contextB, (tx) =>
      tx.workspaceMember.findMany(),
    );
    expect(membersB.map((m) => m.userId)).toEqual([ids.userB]);
    expect(membersB.map((m) => m.userId)).not.toContain(ids.userA);
  });

  // ================================================================
  // AC02: missing and malformed context
  // ================================================================

  it("denies missing context (AC02)", async () => {
    expect(await pooled.organization.findMany()).toEqual([]);
    expect(await pooled.workspace.findMany()).toEqual([]);
    expect(await pooled.workspaceMember.findMany()).toEqual([]);
  });

  it("denies malformed context (AC02)", async () => {
    expect(
      await withContext(
        pooled,
        { ...contextA, userId: "not-a-uuid" },
        (tx) => tx.organization.findMany(),
      ),
    ).toEqual([]);
  });

  // ================================================================
  // AC05: composite FK prevents cross-workspace reference
  // ================================================================

  it("denies an unauthorized cross-workspace membership insert", async () => {
    await expect(
      withContext(pooled, contextA, (tx) =>
        tx.workspaceMember.create({
          data: {
            workspaceId: ids.workspaceB,
            organizationId: ids.organizationA,
            userId: ids.userA,
            role: "viewer",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("denies unauthorized workspace creation", async () => {
    await expect(
      withContext(pooled, contextA, (tx) =>
        tx.workspace.create({
          data: {
            id: randomUUID(),
            organizationId: ids.organizationB,
            slug: "cross-org-ws",
            name: "Cross Org Workspace",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  // ================================================================
  // No context leak across pooled connections
  // ================================================================

  it("clears transaction-local context after rollback", async () => {
    await expect(
      withContext(pooled, contextA, async (tx) => {
        expect(await tx.organization.count()).toBe(1);
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");

    expect(await pooled.organization.findMany()).toEqual([]);
  });

  // The test above relies on the pool being likely, but not guaranteed, to
  // reuse the same physical connection for the follow-up query.
  // connection_limit=1 forces that reuse, so this proves RLS denies by
  // default on the exact connection that just rolled back, not just on
  // whichever one the pool happened to hand back.
  it("clears transaction-local context after rollback on a deterministically reused connection", async () => {
    const singleConnUrl = new URL(directUrl!);
    singleConnUrl.searchParams.set("connection_limit", "1");
    const singleConn = new PrismaClient({ datasourceUrl: singleConnUrl.toString() });
    await singleConn.$connect();
    try {
      await expect(
        withContext(singleConn, contextA, async (tx) => {
          expect(await tx.organization.count()).toBe(1);
          throw new Error("intentional rollback");
        }),
      ).rejects.toThrow("intentional rollback");

      expect(await singleConn.organization.findMany()).toEqual([]);
    } finally {
      await singleConn.$disconnect();
    }
  });

  it("does not leak context when pooled connection changes workspace", async () => {
    const [a, b, missing] = await Promise.all([
      withContext(pooled, contextA, (tx) => tx.organization.findMany()),
      withContext(pooled, contextB, (tx) => tx.organization.findMany()),
      pooled.organization.findMany(),
    ]);
    expect(a.map((row) => row.id)).toEqual([ids.organizationA]);
    expect(b.map((row) => row.id)).toEqual([ids.organizationB]);
    expect(missing).toEqual([]);
  });

  // ================================================================
  // platform_admin_members is inaccessible to app_runtime
  // ================================================================

  it("blocks app_runtime from reading platform_admin_members", async () => {
    await expect(pooled.platformAdminMember.findMany()).rejects.toThrow();
  });

  // ================================================================
  // Profile CRUD
  // ================================================================

  it("reads own profile", async () => {
    const profile = await withContext(pooled, contextA, (tx) =>
      tx.profile.findUnique({ where: { id: ids.userA } }),
    );
    expect(profile?.fullName).toBe("User A");
  });

  it("denies reading another user's profile", async () => {
    const profile = await withContext(pooled, contextA, (tx) =>
      tx.profile.findUnique({ where: { id: ids.userB } }),
    );
    expect(profile).toBeNull();
  });

  // A blocked identity keeps read access to its own row — the server needs the
  // status to reject the request — but loses every write path, including the
  // one that would lift the block.
  it("denies a blocked identity any write to its own profile", async () => {
    const lifted = await withContext(pooled, contextBlocked, (tx) =>
      tx.profile.updateMany({
        where: { id: ids.userBlocked },
        data: { status: "active" },
      }),
    );
    expect(lifted.count).toBe(0);

    const renamed = await withContext(pooled, contextBlocked, (tx) =>
      tx.profile.updateMany({
        where: { id: ids.userBlocked },
        data: { fullName: "still blocked" },
      }),
    );
    expect(renamed.count).toBe(0);

    const stillBlocked = await withContext(pooled, contextBlocked, (tx) =>
      tx.profile.findUnique({ where: { id: ids.userBlocked } }),
    );
    expect(stillBlocked?.status).toBe("blocked");
  });

  it("denies an active identity writing a non-active status", async () => {
    await expect(
      withContext(pooled, contextA, (tx) =>
        tx.profile.updateMany({
          where: { id: ids.userA },
          data: { status: "blocked" },
        }),
      ),
    ).rejects.toThrow();
  });

  // ================================================================
  // Company -> workspace inheritance stays off (spec section 7)
  // ================================================================

  it("denies workspace access to an organization-only member", async () => {
    const workspaces = await withContext(pooled, contextOrgOnly, (tx) =>
      tx.workspace.findMany(),
    );
    expect(workspaces).toEqual([]);

    const members = await withContext(pooled, contextOrgOnly, (tx) =>
      tx.workspaceMember.findMany(),
    );
    expect(members).toEqual([]);

    // The organization itself stays visible: that is the explicit grant.
    const organizations = await withContext(pooled, contextOrgOnly, (tx) =>
      tx.organization.findMany(),
    );
    expect(organizations.map((row) => row.id)).toEqual([ids.organizationA]);
  });

  // ================================================================
  // Revocation takes effect without waiting for the token to expire
  // ================================================================

  it("denies access once the workspace membership is revoked", async () => {
    const workspaces = await withContext(pooled, contextRevoked, (tx) =>
      tx.workspace.findMany(),
    );
    expect(workspaces).toEqual([]);

    const members = await withContext(pooled, contextRevoked, (tx) =>
      tx.workspaceMember.findMany(),
    );
    expect(members).toEqual([]);
  });

  // ================================================================
  // A multi-organization user never escapes the resolved context
  // ================================================================

  it("honours the contextual organization for a multi-organization user", async () => {
    const organizations = await withContext(pooled, contextMultiOrgInA, (tx) =>
      tx.organization.findMany(),
    );
    expect(organizations.map((row) => row.id)).toEqual([ids.organizationA]);

    const memberships = await withContext(pooled, contextMultiOrgInA, (tx) =>
      tx.organizationMember.findMany(),
    );
    expect(
      memberships.filter((row) => row.organizationId === ids.organizationB),
    ).toEqual([]);
  });

  it("denies a context that mixes workspace A with organization B", async () => {
    const mismatched = {
      userId: ids.userMultiOrg,
      workspaceId: ids.workspaceA,
      organizationId: ids.organizationB,
    };

    expect(
      await withContext(pooled, mismatched, (tx) => tx.workspace.findMany()),
    ).toEqual([]);
    expect(
      await withContext(pooled, mismatched, (tx) =>
        tx.workspaceMember.findMany(),
      ),
    ).toEqual([]);
  });
});

// ================================================================
// Context resolution service
// ================================================================

describeDatabase("workspace context resolution", requiredVars, () => {
  const prisma = new PrismaClient({ datasourceUrl: pooledUrl! });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves workspace context from slug for active member", async () => {
    const ctx = await resolveWorkspaceContext(prisma, ids.userA, "workspace-a", HOUSE_PARTNER_ID);
    expect(ctx).toEqual({
      userId: ids.userA,
      workspaceId: ids.workspaceA,
      organizationId: ids.organizationA,
      partnerId: HOUSE_PARTNER_ID,
    });
  });

  it("resolves workspace context for a multi-organization member", async () => {
    const ctx = await resolveWorkspaceContext(
      prisma,
      ids.userMultiOrg,
      "workspace-a",
      HOUSE_PARTNER_ID,
    );
    expect(ctx).toEqual({
      userId: ids.userMultiOrg,
      workspaceId: ids.workspaceA,
      organizationId: ids.organizationA,
      partnerId: HOUSE_PARTNER_ID,
    });
  });

  // Slug resolution is membership-bound, so a foreign tenant's slug is
  // indistinguishable from one that does not exist. That is deliberate: the
  // alternative leaks the existence of other tenants' workspaces.
  it("reports a foreign slug exactly like an unknown slug", async () => {
    await expect(
      resolveWorkspaceContext(prisma, ids.userA, "workspace-b", HOUSE_PARTNER_ID),
    ).rejects.toThrow("Workspace not found or inactive");

    await expect(
      resolveWorkspaceContext(prisma, ids.userA, "nonexistent", HOUSE_PARTNER_ID),
    ).rejects.toThrow("Workspace not found or inactive");
  });

  it("refuses an organization-only member (inheritance off)", async () => {
    await expect(
      resolveWorkspaceContext(prisma, ids.userOrgOnly, "workspace-a", HOUSE_PARTNER_ID),
    ).rejects.toThrow("Workspace not found or inactive");
  });

  it("refuses a revoked workspace membership", async () => {
    await expect(
      resolveWorkspaceContext(prisma, ids.userRevoked, "workspace-a", HOUSE_PARTNER_ID),
    ).rejects.toThrow("Workspace not found or inactive");
  });

  it("refuses every slug without a partner (unknown host)", async () => {
    await expect(
      resolveWorkspaceContext(prisma, ids.userA, "workspace-a", null),
    ).rejects.toThrow("Workspace not found or inactive");
  });

  it("refuses a slug whose organization belongs to another partner", async () => {
    await expect(
      resolveWorkspaceContext(
        prisma,
        ids.userA,
        "workspace-a",
        "00000000-0000-4000-8000-0000000000ff",
      ),
    ).rejects.toThrow("Workspace not found or inactive");
  });

  it("clears transaction-local context after resolution", async () => {
    await resolveWorkspaceContext(prisma, ids.userA, "workspace-a", HOUSE_PARTNER_ID);
    expect(await prisma.organization.findMany()).toEqual([]);
  });
});

// ================================================================
// Concurrency isolation
// ================================================================

describeDatabase("concurrency isolation", requiredVars, () => {
  const prisma = new PrismaClient({ datasourceUrl: pooledUrl! });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("isolates at least 50 concurrent alternating requests", async () => {
    const requests = Array.from({ length: 60 }, async (_, index) => {
      const context = index % 2 === 0 ? contextA : contextB;
      const expectedId = index % 2 === 0 ? ids.organizationA : ids.organizationB;
      const rows = await withContext(prisma, context, (tx) =>
        tx.organization.findMany(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(expectedId);
    });
    await Promise.all(requests);
  });
});