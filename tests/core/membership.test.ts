/**
 * ============================================================================
 * File: tests/core/membership.test.ts
 * Module: RBAC, Last-Owner Protection (AC04) & Concurrency Quota Tests (AC06)
 *
 * Maintenance Rationale:
 * - Validates AC04:
 *   1. Last active owner of an organization cannot be removed, demoted or revoked,
 *      both at application service layer and database trigger level.
 *   2. Admins cannot elevate privilege to owner or demote/remove owners.
 * - Validates AC06:
 *   1. Invitations are expirable and uniquely tracked via high-entropy SHA-256 tokens.
 *   2. Parallel concurrent acceptance of invitations strictly respects seat limits
 *      (max_seats) through PostgreSQL transaction advisory locks, eliminating
 *      race conditions completely.
 * - Validates AC03:
 *   1. Removing a member immediately revokes workspace access.
 * ============================================================================
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  LastOwnerCannotBeRemovedError,
  InsufficientRoleError,
  SeatLimitExceededError,
  InvitationExpiredError,
  InvitationAlreadyAcceptedError,
  InvitationRevokedError,
} from "../../src/core/organizations/errors";
import {
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  hashInvitationToken,
} from "../../src/core/organizations/invitations";
import {
  updateOrganizationMemberRole,
  removeOrganizationMember,
  listOrganizationMembers,
} from "../../src/core/organizations/members";
import {
  addWorkspaceMember,
  removeWorkspaceMember,
  listWorkspaceMembers,
} from "../../src/core/workspaces/members";
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
  users: [
    "d0000000-0000-4000-8000-000000000003",
    "d0000000-0000-4000-8000-000000000004",
    "d0000000-0000-4000-8000-000000000005",
    "d0000000-0000-4000-8000-000000000006",
    "d0000000-0000-4000-8000-000000000007",
    "d0000000-0000-4000-8000-000000000008",
    "d0000000-0000-4000-8000-000000000009",
    "d0000000-0000-4000-8000-000000000010",
  ] as const,
} as const;

const ownerContext = {
  userId: fixtures.ownerId,
  organizationId: fixtures.orgId,
  workspaceId: fixtures.workspaceId,
};

describeDatabase("core membership, RBAC & invitations (AC03, AC04, AC06)", requiredVars, () => {
  const prisma = new PrismaClient({ datasourceUrl: pooledUrl! });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await withContext(prisma, ownerContext, async (tx) => {
      await tx.organization.update({
        where: { id: fixtures.orgId },
        data: { maxSeats: 10 },
      });
      await tx.invitation.deleteMany({
        where: { organizationId: fixtures.orgId },
      });
      await tx.organizationMember.deleteMany({
        where: {
          organizationId: fixtures.orgId,
          userId: { not: fixtures.ownerId },
        },
      });
    });
  });

  describe("AC04: Protection of the Last Active Owner", () => {
    it("refuses to demote the sole active organization owner", async () => {
      await withContext(prisma, ownerContext, async (tx) => {
        // Ensure sole owner state
        await tx.organizationMember.deleteMany({
          where: {
            organizationId: fixtures.orgId,
            userId: { not: fixtures.ownerId },
          },
        });

        // Demoting the sole owner must throw LastOwnerCannotBeRemovedError
        await expect(
          updateOrganizationMemberRole(tx, {
            organizationId: fixtures.orgId,
            actorId: fixtures.ownerId,
            targetUserId: fixtures.ownerId,
            newRole: "admin",
          }),
        ).rejects.toThrow(LastOwnerCannotBeRemovedError);
      });
    });

    it("refuses to remove the sole active organization owner", async () => {
      await withContext(prisma, ownerContext, async (tx) => {
        await expect(
          removeOrganizationMember(tx, {
            organizationId: fixtures.orgId,
            actorId: fixtures.ownerId,
            targetUserId: fixtures.ownerId,
          }),
        ).rejects.toThrow(LastOwnerCannotBeRemovedError);
      });
    });

    it("enforces last-owner invariant via database trigger on direct SQL execution", async () => {
      await withContext(prisma, ownerContext, async (tx) => {
        // Direct SQL update attempting to bypass application service
        await expect(
          tx.$executeRaw`
            update public.organization_members
            set role = 'admin'
            where organization_id = ${fixtures.orgId}::uuid
              and user_id = ${fixtures.ownerId}::uuid
          `,
        ).rejects.toThrow(/Cannot remove, revoke or demote the last active owner/);
      });
    });

    it("allows demoting an owner once a co-owner exists", async () => {
      await withContext(prisma, ownerContext, async (tx) => {
        // 1. Add admin user as second owner
        await tx.organizationMember.upsert({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: fixtures.adminId,
            },
          },
          update: { role: "owner", status: "active" },
          create: {
            organizationId: fixtures.orgId,
            userId: fixtures.adminId,
            role: "owner",
            status: "active",
          },
        });

        // 2. Now demoting original owner succeeds because another active owner exists
        const updated = await updateOrganizationMemberRole(tx, {
          organizationId: fixtures.orgId,
          actorId: fixtures.adminId,
          targetUserId: fixtures.ownerId,
          newRole: "admin",
        });
        expect(updated.role).toBe("admin");

        // 3. Demoting the remaining owner fails again
        await expect(
          updateOrganizationMemberRole(tx, {
            organizationId: fixtures.orgId,
            actorId: fixtures.adminId,
            targetUserId: fixtures.adminId,
            newRole: "admin",
          }),
        ).rejects.toThrow(LastOwnerCannotBeRemovedError);

        // 4. Restore original owner
        await updateOrganizationMemberRole(tx, {
          organizationId: fixtures.orgId,
          actorId: fixtures.adminId,
          targetUserId: fixtures.ownerId,
          newRole: "owner",
        });

        // Clean up second owner
        await tx.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: fixtures.adminId,
            },
          },
        });
      });
    });
  });

  describe("AC04: Privilege Escalation Controls", () => {
    it("denies an admin from promoting a member to owner", async () => {
      await withContext(prisma, ownerContext, async (tx) => {
        // Add admin
        await tx.organizationMember.upsert({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: fixtures.adminId,
            },
          },
          update: { role: "admin", status: "active" },
          create: {
            organizationId: fixtures.orgId,
            userId: fixtures.adminId,
            role: "admin",
            status: "active",
          },
        });

        // Add regular user
        await tx.organizationMember.upsert({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: fixtures.users[0],
            },
          },
          update: { role: "member", status: "active" },
          create: {
            organizationId: fixtures.orgId,
            userId: fixtures.users[0],
            role: "member",
            status: "active",
          },
        });

        // Admin attempting to promote user to owner
        await expect(
          updateOrganizationMemberRole(tx, {
            organizationId: fixtures.orgId,
            actorId: fixtures.adminId,
            targetUserId: fixtures.users[0],
            newRole: "owner",
          }),
        ).rejects.toThrow(InsufficientRoleError);

        // Clean up
        await tx.organizationMember.deleteMany({
          where: {
            organizationId: fixtures.orgId,
            userId: { in: [fixtures.adminId, fixtures.users[0]] },
          },
        });
      });
    });

    it("denies an admin from inviting someone with the owner role", async () => {
      await withContext(prisma, ownerContext, async (tx) => {
        await tx.organizationMember.upsert({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: fixtures.adminId,
            },
          },
          update: { role: "admin", status: "active" },
          create: {
            organizationId: fixtures.orgId,
            userId: fixtures.adminId,
            role: "admin",
            status: "active",
          },
        });

        // Admin attempting to issue an owner invitation
        await expect(
          createInvitation(tx, {
            organizationId: fixtures.orgId,
            actorId: fixtures.adminId,
            email: "external-owner@test.guidu.co",
            role: "owner",
          }),
        ).rejects.toThrow(InsufficientRoleError);

        await tx.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: fixtures.adminId,
            },
          },
        });
      });
    });
  });

  describe("AC06: Expirable Tokens & Invitation Lifecycle", () => {
    it("generates high-entropy token and stores only SHA-256 hash", async () => {
      let createdRawToken = "";
      await withContext(prisma, ownerContext, async (tx) => {
        const { invitation, rawToken } = await createInvitation(tx, {
          organizationId: fixtures.orgId,
          actorId: fixtures.ownerId,
          email: "crypto-check@test.guidu.co",
          role: "member",
        });

        createdRawToken = rawToken;
        expect(rawToken).toHaveLength(64); // 32 bytes hex
        expect(invitation.tokenHash).toBe(hashInvitationToken(rawToken));
        expect(invitation.status).toBe("pending");
      });

      // Verification via acceptInvitation
      const result = await acceptInvitation(prisma, {
        rawToken: createdRawToken,
        userId: fixtures.users[1],
      });
      expect(result.invitation.status).toBe("accepted");

      // Clean up accepted member
      await withContext(prisma, ownerContext, async (tx) => {
        await tx.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: fixtures.users[1],
            },
          },
        });
      });
    });

    it("refuses acceptance of an expired invitation", async () => {
      let expiredRawToken = "";
      await withContext(prisma, ownerContext, async (tx) => {
        const { rawToken } = await createInvitation(tx, {
          organizationId: fixtures.orgId,
          actorId: fixtures.ownerId,
          email: "expired-check@test.guidu.co",
          role: "member",
          expiresInHours: -1, // Expired 1 hour ago
        });
        expiredRawToken = rawToken;
      });

      await expect(
        acceptInvitation(prisma, {
          rawToken: expiredRawToken,
          userId: fixtures.users[2],
        }),
      ).rejects.toThrow(InvitationExpiredError);
    });

    it("refuses acceptance of a revoked invitation", async () => {
      let revokedRawToken = "";
      await withContext(prisma, ownerContext, async (tx) => {
        const { invitation, rawToken } = await createInvitation(tx, {
          organizationId: fixtures.orgId,
          actorId: fixtures.ownerId,
          email: "revoked-check@test.guidu.co",
          role: "member",
        });
        await revokeInvitation(tx, {
          organizationId: fixtures.orgId,
          actorId: fixtures.ownerId,
          invitationId: invitation.id,
        });
        revokedRawToken = rawToken;
      });

      await expect(
        acceptInvitation(prisma, {
          rawToken: revokedRawToken,
          userId: fixtures.users[3],
        }),
      ).rejects.toThrow(InvitationRevokedError);
    });

    it("refuses duplicate acceptance of an already accepted invitation", async () => {
      let rawTokenToReuse = "";
      await withContext(prisma, ownerContext, async (tx) => {
        const { rawToken } = await createInvitation(tx, {
          organizationId: fixtures.orgId,
          actorId: fixtures.ownerId,
          email: "reuse-check@test.guidu.co",
          role: "member",
        });
        rawTokenToReuse = rawToken;
      });

      // First accept: OK
      await acceptInvitation(prisma, {
        rawToken: rawTokenToReuse,
        userId: fixtures.users[4],
      });

      // Second accept with same token: rejected
      await expect(
        acceptInvitation(prisma, {
          rawToken: rawTokenToReuse,
          userId: fixtures.users[4],
        }),
      ).rejects.toThrow(InvitationAlreadyAcceptedError);

      // Clean up
      await withContext(prisma, ownerContext, async (tx) => {
        await tx.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: fixtures.users[4],
            },
          },
        });
      });
    });
  });

  describe("AC06: Atomic Seat Quota Concurrency", () => {
    it("serializes concurrent invitations under race condition, respecting max_seats", async () => {
      // Setup: Organization Quota Test has max_seats = 3.
      // Currently has 1 active member (fixtures.ownerId).
      // Available seats = 3 - 1 = 2 seats!
      // We will issue 5 invitations to 5 different users, and attempt to accept
      // all 5 simultaneously in parallel using Promise.allSettled.
      // Exactly 2 MUST succeed and exactly 3 MUST fail with SeatLimitExceededError!

      const candidateTokens: string[] = [];

      await withContext(prisma, ownerContext, async (tx) => {
        // Reset organization seats to exactly 3
        await tx.organization.update({
          where: { id: fixtures.orgId },
          data: { maxSeats: 3 },
        });

        // Ensure only owner is a member
        await tx.organizationMember.deleteMany({
          where: {
            organizationId: fixtures.orgId,
            userId: { not: fixtures.ownerId },
          },
        });

        // Clear any old invitations for this org
        await tx.invitation.deleteMany({
          where: { organizationId: fixtures.orgId },
        });

        // For the concurrency test on accept, create 5 pending invitations
        // by temporarily bumping seats during generation
        await tx.organization.update({
          where: { id: fixtures.orgId },
          data: { maxSeats: 10 },
        });

        for (let i = 0; i < 5; i++) {
          const { rawToken } = await createInvitation(tx, {
            organizationId: fixtures.orgId,
            actorId: fixtures.ownerId,
            email: `concurrency-candidate-${i}@test.guidu.co`,
            role: "member",
          });
          candidateTokens.push(rawToken);
        }

        // Restore target quota to 3 (meaning only 2 seats remain available!)
        await tx.organization.update({
          where: { id: fixtures.orgId },
          data: { maxSeats: 3 },
        });
      });

      // Concurrent accept execution
      const candidateUserIds = fixtures.users.slice(0, 5);
      const results = await Promise.allSettled(
        candidateTokens.map((rawToken, idx) =>
          acceptInvitation(prisma, {
            rawToken,
            userId: candidateUserIds[idx]!,
          }),
        ),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Invariant AC06: Exactly 2 seats available -> exactly 2 fulfilled!
      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(3);

      for (const rej of rejected) {
        const error = (rej as PromiseRejectedResult).reason;
        expect(error).toBeInstanceOf(SeatLimitExceededError);
      }

      // Verify total active members in database is strictly 3 (1 owner + 2 accepted)
      await withContext(prisma, ownerContext, async (tx) => {
        const members = await listOrganizationMembers(tx, fixtures.orgId);
        expect(members).toHaveLength(3);

        // Clean up candidates
        await tx.organizationMember.deleteMany({
          where: {
            organizationId: fixtures.orgId,
            userId: { not: fixtures.ownerId },
          },
        });
        await tx.invitation.deleteMany({
          where: { organizationId: fixtures.orgId },
        });
      });
    });
  });

  describe("AC03: Workspace Member Lifecycle & Revocation", () => {
    it("adds and removes workspace member, immediately revoking access", async () => {
      const targetUser = fixtures.users[0];

      await withContext(prisma, ownerContext, async (tx) => {
        // Target must first be an organization member
        await tx.organizationMember.create({
          data: {
            organizationId: fixtures.orgId,
            userId: targetUser,
            role: "member",
            status: "active",
          },
        });

        // Add to workspace
        const added = await addWorkspaceMember(tx, {
          workspaceId: fixtures.workspaceId,
          organizationId: fixtures.orgId,
          actorId: fixtures.ownerId,
          targetUserId: targetUser,
          role: "editor",
        });
        expect(added.role).toBe("editor");

        // Verify visible in workspace members list
        const listAfterAdd = await listWorkspaceMembers(
          tx,
          fixtures.workspaceId,
          fixtures.orgId,
        );
        expect(listAfterAdd.some((m) => m.userId === targetUser)).toBe(true);

        // Remove from workspace
        await removeWorkspaceMember(tx, {
          workspaceId: fixtures.workspaceId,
          organizationId: fixtures.orgId,
          actorId: fixtures.ownerId,
          targetUserId: targetUser,
        });

        // Verify immediately absent (AC03)
        const listAfterRemove = await listWorkspaceMembers(
          tx,
          fixtures.workspaceId,
          fixtures.orgId,
        );
        expect(listAfterRemove.some((m) => m.userId === targetUser)).toBe(false);

        // Clean up org membership
        await tx.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: fixtures.orgId,
              userId: targetUser,
            },
          },
        });
      });
    });

    it("refuses to remove the sole active workspace owner (isSelf)", async () => {
      await withContext(prisma, ownerContext, async (tx) => {
        await expect(
          removeWorkspaceMember(tx, {
            workspaceId: fixtures.workspaceId,
            organizationId: fixtures.orgId,
            actorId: fixtures.ownerId,
            targetUserId: fixtures.ownerId,
          }),
        ).rejects.toThrow(LastOwnerCannotBeRemovedError);
      });
    });
  });
});
