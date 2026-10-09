/**
 * ============================================================================
 * File: tests/core/audit.test.ts
 * Module: Append-Only Audit Trail Integration Suite (Spec §6, §16, §20, §24 AC14 & ADR 0009)
 *
 * Maintenance Rationale:
 * - Validates §20 & AC14:
 *   1. Critical domain operations (credentials, API keys, invitations, memberships)
 *      atomically record exactly one audit event in the same transaction as the change.
 *   2. If the domain transaction fails, the success audit event is rolled back.
 *   3. Security guards that deny critical actions (credentials.manage, api_keys.revoke_any,
 *      workspace.members.manage) record a result = 'denied' event in a short dedicated
 *      transaction before throwing.
 *   4. Sensitive secrets (raw BYOK secrets, raw API keys, full plain emails) NEVER appear
 *      in the audit metadata.
 *   5. Queries count(*) and reads from audit_events strictly as `app_migrations` (or admin),
 *      since `app_runtime` has no SELECT privileges.
 * ============================================================================
 */

import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { registerCredential, revokeCredential } from "@/core/credentials/vault";
import { createApiKey, revokeApiKey } from "@/core/credentials/api-keys";
import {
  createInvitation,
  acceptInvitation,
  revokeInvitation,
} from "@/core/organizations/invitations";
import {
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
  addWorkspaceMember,
} from "@/core/workspaces/members";
import {
  updateOrganizationMemberRole,
  removeOrganizationMember,
} from "@/core/organizations/members";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database";

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;

const requiredVars = {
  DATABASE_URL: pooledUrl,
  DIRECT_DATABASE_URL: directUrl,
  ADMIN_URL: adminUrl,
};

describeDatabase("Append-Only Audit Trail (C11, Spec §6, §16, §20, §24 AC14 & ADR 0009)", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: directUrl ?? pooledUrl ?? "" } },
  });

  let adminClient: pg.Client | null = null;

  beforeAll(async () => {
    await prisma.$connect();
    if (adminUrl) {
      adminClient = new pg.Client({
        connectionString: adminUrl,
        ssl:
          adminUrl.includes("localhost") || adminUrl.includes("127.0.0.1")
            ? false
            : { rejectUnauthorized: false },
      });
      await adminClient.connect();
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (adminClient) {
      await adminClient.end();
    }
  });

  async function getAuditEventCount(action: string, result = "success"): Promise<number> {
    if (!adminClient) throw new Error("adminClient is required to count audit_events");
    const res = await adminClient.query<{ count: string }>(
      "select count(*)::text as count from public.audit_events where action = $1 and result = $2",
      [action, result],
    );
    return parseInt(res.rows[0]?.count ?? "0", 10);
  }

  async function getLatestAuditEvent(action: string, result = "success") {
    if (!adminClient) throw new Error("adminClient is required to inspect audit_events");
    const res = await adminClient.query(
      "select * from public.audit_events where action = $1 and result = $2 order by occurred_at desc limit 1",
      [action, result],
    );
    return res.rows[0];
  }

  describe("Credentials Audit Trail (credentials.created, credentials.revoked)", () => {
    it("records exactly 1 event on credential creation without exposing the raw secret", async () => {
      const initialCount = await getAuditEventCount("credentials.created");
      const rawSecret = "sk-super-secret-openai-api-key-999888";

      const created = await withContext(prisma, contextA, async (tx) => {
        return registerCredential(tx, contextA, {
          provider: "openai",
          label: "Test OpenAI Key",
          secret: rawSecret,
          purpose: "chat",
        });
      });

      const newCount = await getAuditEventCount("credentials.created");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("credentials.created");
      expect(event.resource_type).toBe("credential");
      expect(event.resource_id).toBe(created.id);
      expect(event.actor_user_id).toBe(contextA.userId);
      expect(event.workspace_id).toBe(contextA.workspaceId);
      expect(event.organization_id).toBe(contextA.organizationId);

      // Verify metadata strictly masks value and NEVER leaks raw secret
      const metadataStr = JSON.stringify(event.metadata);
      expect(metadataStr).not.toContain(rawSecret);
      expect(event.metadata.maskedValue).toBe(created.maskedValue);
      expect(event.metadata.provider).toBe("openai");
      expect(event.metadata.purpose).toBe("chat");
    });

    it("records exactly 1 event on credential revocation", async () => {
      // Create first
      const created = await withContext(prisma, contextA, async (tx) => {
        return registerCredential(tx, contextA, {
          provider: "anthropic",
          label: "Revocable Anthropic Key",
          secret: "sk-ant-temporary-secret-key-111222",
        });
      });

      const initialCount = await getAuditEventCount("credentials.revoked");

      await withContext(prisma, contextA, async (tx) => {
        return revokeCredential(tx, contextA, created.id);
      });

      const newCount = await getAuditEventCount("credentials.revoked");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("credentials.revoked");
      expect(event.resource_id).toBe(created.id);
      expect(event.metadata.provider).toBe("anthropic");
    });
  });

  describe("API Keys Audit Trail (api_keys.created, api_keys.revoked)", () => {
    it("records exactly 1 event on API key creation without exposing raw key", async () => {
      const initialCount = await getAuditEventCount("api_keys.created");

      const { apiKey, rawKey } = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "MCP Claude Assistant Key",
          scopes: ["read", "proposals:write"],
          expiresInDays: 30,
        });
      });

      const newCount = await getAuditEventCount("api_keys.created");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("api_keys.created");
      expect(event.resource_type).toBe("api_key");
      expect(event.resource_id).toBe(apiKey.id);

      // Verify rawKey is NEVER leaked in audit metadata
      const metadataStr = JSON.stringify(event.metadata);
      expect(metadataStr).not.toContain(rawKey);
      expect(event.metadata.prefix).toBe(apiKey.prefix);
      expect(event.metadata.scopes).toEqual(["read", "proposals:write"]);
    });

    it("records exactly 1 event on API key revocation", async () => {
      const { apiKey } = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "Temporary API Key",
        });
      });

      const initialCount = await getAuditEventCount("api_keys.revoked");

      await withContext(prisma, contextA, async (tx) => {
        return revokeApiKey(tx, contextA, apiKey.id);
      });

      const newCount = await getAuditEventCount("api_keys.revoked");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("api_keys.revoked");
      expect(event.resource_id).toBe(apiKey.id);
      expect(event.metadata.prefix).toBe(apiKey.prefix);
    });
  });

  describe("Invitations Audit Trail (invitations.created, invitations.revoked, invitations.accepted)", () => {
    it("records exactly 1 event on invitation creation without exposing full email", async () => {
      const initialCount = await getAuditEventCount("invitations.created");
      const candidateEmail = `audit_invite_${Date.now()}@guidu-partner.com`;

      const result = await withContext(prisma, contextA, async (tx) => {
        return createInvitation(tx, {
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          email: candidateEmail,
          role: "viewer",
          workspaceId: contextA.workspaceId,
        });
      });

      const newCount = await getAuditEventCount("invitations.created");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("invitations.created");
      expect(event.resource_type).toBe("invitation");
      expect(event.resource_id).toBe(result.invitation.id);

      // Full email must NOT appear; emailDomain is allowed
      const metadataStr = JSON.stringify(event.metadata);
      expect(metadataStr).not.toContain(candidateEmail);
      expect(event.metadata.emailDomain).toBe("guidu-partner.com");
      expect(event.metadata.role).toBe("viewer");
    });

    it("records exactly 1 event on invitation revocation", async () => {
      const candidateEmail = `revoke_audit_${Date.now()}@guidu-corp.com`;
      const created = await withContext(prisma, contextA, async (tx) => {
        return createInvitation(tx, {
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          email: candidateEmail,
          role: "viewer",
          workspaceId: contextA.workspaceId,
        });
      });

      const initialCount = await getAuditEventCount("invitations.revoked");

      await withContext(prisma, contextA, async (tx) => {
        return revokeInvitation(tx, {
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          invitationId: created.invitation.id,
        });
      });

      const newCount = await getAuditEventCount("invitations.revoked");
      expect(newCount).toBe(initialCount + 1);
    });

    it("records exactly 1 event on invitation acceptance", async () => {
      const targetUser = ids.userOrgOnly;
      const candidateEmail = "org_only_user@example.com";

      const created = await withContext(prisma, contextA, async (tx) => {
        return createInvitation(tx, {
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          email: candidateEmail,
          role: "viewer",
          workspaceId: contextA.workspaceId,
        });
      });

      const initialCount = await getAuditEventCount("invitations.accepted");

      await acceptInvitation(prisma, {
        rawToken: created.rawToken,
        identity: {
          userId: targetUser,
          email: candidateEmail,
          emailConfirmedAt: new Date().toISOString(),
          mfaSatisfied: false,
          profile: {
            id: targetUser,
            fullName: "Org Only Member",
            status: "active",
            statusReason: null,
            lastSignInAt: null,
          },
        },
      });

      const newCount = await getAuditEventCount("invitations.accepted");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("invitations.accepted");
      expect(event.resource_id).toBe(created.invitation.id);
      expect(event.actor_user_id).toBe(targetUser);
    });
  });

  describe("Membership Audit Trail (role_changed & removed)", () => {
    it("records workspace_members.role_changed and workspace_members.removed", async () => {
      const targetUser = ids.userOrgOnly;

      // Ensure membership exists in workspace A
      await withContext(prisma, contextA, async (tx) => {
        await addWorkspaceMember(tx, {
          workspaceId: contextA.workspaceId,
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          targetUserId: targetUser,
          role: "viewer",
        });
      });

      // 1. Update role
      const initialRoleChangedCount = await getAuditEventCount("workspace_members.role_changed");

      await withContext(prisma, contextA, async (tx) => {
        return updateWorkspaceMemberRole(tx, {
          workspaceId: contextA.workspaceId,
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          targetUserId: targetUser,
          newRole: "editor",
        });
      });

      const newRoleChangedCount = await getAuditEventCount("workspace_members.role_changed");
      expect(newRoleChangedCount).toBe(initialRoleChangedCount + 1);

      const roleEvent = await getLatestAuditEvent("workspace_members.role_changed");
      expect(roleEvent.metadata.from).toBe("viewer");
      expect(roleEvent.metadata.to).toBe("editor");
      expect(roleEvent.metadata.targetUserId).toBe(targetUser);

      // 2. Remove workspace member
      const initialRemovedCount = await getAuditEventCount("workspace_members.removed");

      await withContext(prisma, contextA, async (tx) => {
        return removeWorkspaceMember(tx, {
          workspaceId: contextA.workspaceId,
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          targetUserId: targetUser,
        });
      });

      const newRemovedCount = await getAuditEventCount("workspace_members.removed");
      expect(newRemovedCount).toBe(initialRemovedCount + 1);

      const removedEvent = await getLatestAuditEvent("workspace_members.removed");
      expect(removedEvent.metadata.targetUserId).toBe(targetUser);
      expect(removedEvent.metadata.role).toBe("editor");
    });

    it("records organization_members.role_changed", async () => {
      const initialCount = await getAuditEventCount("organization_members.role_changed");
      const targetUser = ids.userMultiOrg;

      await withContext(prisma, contextA, async (tx) => {
        return updateOrganizationMemberRole(tx, {
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          targetUserId: targetUser,
          newRole: "admin",
        });
      });

      const newCount = await getAuditEventCount("organization_members.role_changed");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("organization_members.role_changed");
      expect(event.metadata.targetUserId).toBe(targetUser);
      expect(event.metadata.to).toBe("admin");
    });

    it("records organization_members.removed", async () => {
      const initialCount = await getAuditEventCount("organization_members.removed");
      const targetUser = ids.userOrgOnly;

      await withContext(prisma, contextA, async (tx) => {
        return removeOrganizationMember(tx, {
          organizationId: contextA.organizationId,
          actorId: contextA.userId,
          targetUserId: targetUser,
        });
      });

      const newCount = await getAuditEventCount("organization_members.removed");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("organization_members.removed");
      expect(event.metadata.targetUserId).toBe(targetUser);
    });
  });

  describe("Transaction Rollback Guarantee (§20, AC14)", () => {
    it("rolls back the audit event completely if the domain mutation transaction fails", async () => {
      const initialSuccessCount = await getAuditEventCount("credentials.created");

      // Attempt to register credential with intentionally failing post-mutation step
      await expect(
        withContext(prisma, contextA, async (tx) => {
          await registerCredential(tx, contextA, {
            provider: "openai",
            label: "Doomed Credential",
            secret: "sk-doomed-secret-999",
          });
          // Deliberate simulated transaction failure
          throw new Error("Simulated downstream operational crash");
        }),
      ).rejects.toThrow("Simulated downstream operational crash");

      // Verify NO audit event was committed
      const afterCount = await getAuditEventCount("credentials.created");
      expect(afterCount).toBe(initialSuccessCount);
    });
  });

  describe("Security Denial Audit Trail (credentials.manage, workspace.members.manage, api_keys.revoke_any)", () => {
    it("records result = 'denied' in dedicated transaction when credentials.manage is denied", async () => {
      const initialDeniedCount = await getAuditEventCount("credentials.manage", "denied");

      const viewerContext = {
        userId: ids.userMultiOrg, // viewer in Workspace A
        workspaceId: contextA.workspaceId,
        organizationId: contextA.organizationId,
      };

      await expect(
        withContext(prisma, viewerContext, async (tx) => {
          return registerCredential(tx, viewerContext, {
            provider: "openai",
            label: "Unauthorized Key",
            secret: "sk-unauthorized-secret-000",
          });
        }),
      ).rejects.toThrow(PermissionDeniedError);

      const newDeniedCount = await getAuditEventCount("credentials.manage", "denied");
      expect(newDeniedCount).toBe(initialDeniedCount + 1);

      const event = await getLatestAuditEvent("credentials.manage", "denied");
      expect(event.actor_user_id).toBe(ids.userMultiOrg);
      expect(event.result).toBe("denied");
      expect(event.resource_type).toBe("credential");
    });

    it("records result = 'denied' when workspace.members.manage is denied", async () => {
      const initialDeniedCount = await getAuditEventCount("workspace.members.manage", "denied");

      const viewerContext = {
        userId: ids.userMultiOrg,
        workspaceId: contextA.workspaceId,
        organizationId: contextA.organizationId,
      };

      await expect(
        withContext(prisma, viewerContext, async (tx) => {
          return updateWorkspaceMemberRole(tx, {
            workspaceId: contextA.workspaceId,
            organizationId: contextA.organizationId,
            actorId: ids.userMultiOrg,
            targetUserId: ids.userA,
            newRole: "editor",
          });
        }),
      ).rejects.toThrow(PermissionDeniedError);

      const newDeniedCount = await getAuditEventCount("workspace.members.manage", "denied");
      expect(newDeniedCount).toBe(initialDeniedCount + 1);

      const event = await getLatestAuditEvent("workspace.members.manage", "denied");
      expect(event.result).toBe("denied");
      expect(event.resource_type).toBe("workspace_member");
    });

    it("records result = 'denied' when api_keys.revoke_any is denied to non-admin", async () => {
      // 1. Create key as owner
      const { apiKey } = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "Owner Private Key",
        });
      });

      const initialDeniedCount = await getAuditEventCount("api_keys.revoke_any", "denied");

      const editorContext = {
        userId: ids.userMultiOrg,
        workspaceId: contextA.workspaceId,
        organizationId: contextA.organizationId,
      };

      // 2. Member without revoke_any attempts to revoke owner's key
      await expect(
        withContext(prisma, editorContext, async (tx) => {
          return revokeApiKey(tx, editorContext, apiKey.id);
        }),
      ).rejects.toThrow(PermissionDeniedError);

      const newDeniedCount = await getAuditEventCount("api_keys.revoke_any", "denied");
      expect(newDeniedCount).toBe(initialDeniedCount + 1);

      const event = await getLatestAuditEvent("api_keys.revoke_any", "denied");
      expect(event.result).toBe("denied");
      expect(event.resource_id).toBe(apiKey.id);
    });
  });
});
