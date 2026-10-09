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
 *   6. Uses isolated synthetic fixtures (UUID range e000...) to guarantee no side-effects
 *      on shared fixtures or other concurrent/subsequent test suites.
 * ============================================================================
 */

import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { describeDatabase } from "../prisma-rls/describe-database";

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;

const requiredVars = {
  DATABASE_URL: pooledUrl,
  DIRECT_DATABASE_URL: directUrl,
  ADMIN_URL: adminUrl,
};

// Synthetic fixtures defined in tests/core/audit-seed.sql (UUID range e000...)
const auditFixtures = {
  orgId: "e0000000-0000-4000-8000-000000000010",
  workspaceId: "e0000000-0000-4000-8000-000000000011",
  ownerId: "e0000000-0000-4000-8000-000000000031",
  editorId: "e0000000-0000-4000-8000-000000000032",
  viewerId: "e0000000-0000-4000-8000-000000000033",
  targetId: "e0000000-0000-4000-8000-000000000034",
};

const contextOwner = {
  userId: auditFixtures.ownerId,
  organizationId: auditFixtures.orgId,
  workspaceId: auditFixtures.workspaceId,
};

const contextEditor = {
  userId: auditFixtures.editorId,
  organizationId: auditFixtures.orgId,
  workspaceId: auditFixtures.workspaceId,
};

const contextViewer = {
  userId: auditFixtures.viewerId,
  organizationId: auditFixtures.orgId,
  workspaceId: auditFixtures.workspaceId,
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

      // Ensure seed fixtures are initialized
      await adminClient.query(`
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values
          ('00000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000031', 'authenticated', 'authenticated', 'audit-owner@test.guidu.co', '', now(), '{}', '{}', now(), now()),
          ('00000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000032', 'authenticated', 'authenticated', 'audit-editor@test.guidu.co', '', now(), '{}', '{}', now(), now()),
          ('00000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000033', 'authenticated', 'authenticated', 'audit-viewer@test.guidu.co', '', now(), '{}', '{}', now(), now()),
          ('00000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000034', 'authenticated', 'authenticated', 'audit-target@test.guidu.co', '', now(), '{}', '{}', now(), now())
        on conflict (id) do nothing;

        insert into public.profiles (id, full_name, status) values
          ('e0000000-0000-4000-8000-000000000031', 'Audit Test Owner', 'active'),
          ('e0000000-0000-4000-8000-000000000032', 'Audit Test Editor', 'active'),
          ('e0000000-0000-4000-8000-000000000033', 'Audit Test Viewer', 'active'),
          ('e0000000-0000-4000-8000-000000000034', 'Audit Target Member', 'active')
        on conflict (id) do nothing;

        insert into public.organizations (id, name, status, max_seats) values
          ('e0000000-0000-4000-8000-000000000010', 'Organization Audit Test', 'active', 50)
        on conflict (id) do update set max_seats = 50;

        insert into public.workspaces (id, organization_id, slug, name, status) values
          ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'workspace-audit-test', 'Workspace Audit Test', 'active')
        on conflict (id) do nothing;

        insert into public.organization_members (organization_id, user_id, role, status) values
          ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000031', 'owner', 'active'),
          ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000032', 'admin', 'active'),
          ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000033', 'admin', 'active'),
          ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000034', 'member', 'active')
        on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active';

        insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
          ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000031', 'owner', 'active'),
          ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000032', 'editor', 'active'),
          ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000033', 'viewer', 'active')
        on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active';
      `);
    }
  });

  beforeEach(async () => {
    if (adminClient) {
      // Ensure target user is reset to member in org and not in workspace before each test
      await adminClient.query(
        "delete from public.workspace_members where workspace_id = $1 and user_id = $2",
        [auditFixtures.workspaceId, auditFixtures.targetId],
      );
      await adminClient.query(
        `insert into public.organization_members (organization_id, user_id, role, status)
         values ($1, $2, 'member', 'active')
         on conflict (organization_id, user_id) do update set role = 'member', status = 'active'`,
        [auditFixtures.orgId, auditFixtures.targetId],
      );
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
      "select count(*)::text as count from public.audit_events where action = $1 and result = $2 and organization_id = $3",
      [action, result, auditFixtures.orgId],
    );
    return parseInt(res.rows[0]?.count ?? "0", 10);
  }

  async function getLatestAuditEvent(action: string, result = "success") {
    if (!adminClient) throw new Error("adminClient is required to inspect audit_events");
    const res = await adminClient.query(
      "select * from public.audit_events where action = $1 and result = $2 and organization_id = $3 order by occurred_at desc limit 1",
      [action, result, auditFixtures.orgId],
    );
    return res.rows[0];
  }

  describe("Credentials Audit Trail (credentials.created, credentials.revoked)", () => {
    it("records exactly 1 event on credential creation without exposing the raw secret", async () => {
      const initialCount = await getAuditEventCount("credentials.created");
      const rawSecret = "sk-super-secret-openai-api-key-999888";

      const created = await withContext(prisma, contextOwner, async (tx) => {
        return registerCredential(tx, contextOwner, {
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
      expect(event.actor_user_id).toBe(contextOwner.userId);
      expect(event.workspace_id).toBe(contextOwner.workspaceId);
      expect(event.organization_id).toBe(contextOwner.organizationId);

      // Verify metadata strictly masks value and NEVER leaks raw secret
      const metadataStr = JSON.stringify(event.metadata);
      expect(metadataStr).not.toContain(rawSecret);
      expect(event.metadata.maskedValue).toBe(created.maskedValue);
      expect(event.metadata.provider).toBe("openai");
      expect(event.metadata.purpose).toBe("chat");
    });

    it("records exactly 1 event on credential revocation", async () => {
      // Create first
      const created = await withContext(prisma, contextOwner, async (tx) => {
        return registerCredential(tx, contextOwner, {
          provider: "anthropic",
          label: "Revocable Anthropic Key",
          secret: "sk-ant-temporary-secret-key-111222",
        });
      });

      const initialCount = await getAuditEventCount("credentials.revoked");

      await withContext(prisma, contextOwner, async (tx) => {
        return revokeCredential(tx, contextOwner, created.id);
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

      const { apiKey, rawKey } = await withContext(prisma, contextOwner, async (tx) => {
        return createApiKey(tx, contextOwner, {
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
      const { apiKey } = await withContext(prisma, contextOwner, async (tx) => {
        return createApiKey(tx, contextOwner, {
          name: "Temporary API Key",
        });
      });

      const initialCount = await getAuditEventCount("api_keys.revoked");

      await withContext(prisma, contextOwner, async (tx) => {
        return revokeApiKey(tx, contextOwner, apiKey.id);
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

      const result = await withContext(prisma, contextOwner, async (tx) => {
        return createInvitation(tx, {
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
          email: candidateEmail,
          role: "viewer",
          workspaceId: contextOwner.workspaceId,
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
      const created = await withContext(prisma, contextOwner, async (tx) => {
        return createInvitation(tx, {
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
          email: candidateEmail,
          role: "viewer",
          workspaceId: contextOwner.workspaceId,
        });
      });

      const initialCount = await getAuditEventCount("invitations.revoked");

      await withContext(prisma, contextOwner, async (tx) => {
        return revokeInvitation(tx, {
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
          invitationId: created.invitation.id,
        });
      });

      const newCount = await getAuditEventCount("invitations.revoked");
      expect(newCount).toBe(initialCount + 1);
    });

    it("records exactly 1 event on invitation acceptance", async () => {
      const targetUser = auditFixtures.targetId;
      const candidateEmail = "audit-target@test.guidu.co";

      const created = await withContext(prisma, contextOwner, async (tx) => {
        return createInvitation(tx, {
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
          email: candidateEmail,
          role: "viewer",
          workspaceId: contextOwner.workspaceId,
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
            fullName: "Audit Target Member",
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
      const targetUser = auditFixtures.targetId;

      // Ensure membership exists in workspace
      await withContext(prisma, contextOwner, async (tx) => {
        await addWorkspaceMember(tx, {
          workspaceId: contextOwner.workspaceId,
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
          targetUserId: targetUser,
          role: "viewer",
        });
      });

      // 1. Update role
      const initialRoleChangedCount = await getAuditEventCount("workspace_members.role_changed");

      await withContext(prisma, contextOwner, async (tx) => {
        return updateWorkspaceMemberRole(tx, {
          workspaceId: contextOwner.workspaceId,
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
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

      await withContext(prisma, contextOwner, async (tx) => {
        return removeWorkspaceMember(tx, {
          workspaceId: contextOwner.workspaceId,
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
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
      const targetUser = auditFixtures.targetId;

      await withContext(prisma, contextOwner, async (tx) => {
        return updateOrganizationMemberRole(tx, {
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
          targetUserId: targetUser,
          newRole: "admin",
        });
      });

      const newCount = await getAuditEventCount("organization_members.role_changed");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("organization_members.role_changed");
      expect(event.metadata.targetUserId).toBe(targetUser);
      expect(event.metadata.from).toBe("member");
      expect(event.metadata.to).toBe("admin");
    });

    it("records organization_members.removed", async () => {
      const initialCount = await getAuditEventCount("organization_members.removed");
      const targetUser = auditFixtures.targetId;

      await withContext(prisma, contextOwner, async (tx) => {
        return removeOrganizationMember(tx, {
          organizationId: contextOwner.organizationId,
          actorId: contextOwner.userId,
          targetUserId: targetUser,
        });
      });

      const newCount = await getAuditEventCount("organization_members.removed");
      expect(newCount).toBe(initialCount + 1);

      const event = await getLatestAuditEvent("organization_members.removed");
      expect(event.metadata.targetUserId).toBe(targetUser);
      expect(event.metadata.role).toBe("member");
    });
  });

  describe("Transaction Rollback Guarantee (§20, AC14)", () => {
    it("rolls back the audit event completely if the domain mutation transaction fails", async () => {
      const initialSuccessCount = await getAuditEventCount("credentials.created");

      // Attempt to register credential with intentionally failing post-mutation step
      await expect(
        withContext(prisma, contextOwner, async (tx) => {
          await registerCredential(tx, contextOwner, {
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

      await expect(
        withContext(prisma, contextViewer, async (tx) => {
          return registerCredential(tx, contextViewer, {
            provider: "openai",
            label: "Unauthorized Key",
            secret: "sk-unauthorized-secret-000",
          });
        }),
      ).rejects.toThrow(PermissionDeniedError);

      const newDeniedCount = await getAuditEventCount("credentials.manage", "denied");
      expect(newDeniedCount).toBe(initialDeniedCount + 1);

      const event = await getLatestAuditEvent("credentials.manage", "denied");
      expect(event.actor_user_id).toBe(contextViewer.userId);
      expect(event.result).toBe("denied");
      expect(event.resource_type).toBe("credential");
    });

    it("records result = 'denied' when workspace.members.manage is denied", async () => {
      const initialDeniedCount = await getAuditEventCount("workspace.members.manage", "denied");

      await expect(
        withContext(prisma, contextViewer, async (tx) => {
          return updateWorkspaceMemberRole(tx, {
            workspaceId: contextViewer.workspaceId,
            organizationId: contextViewer.organizationId,
            actorId: contextViewer.userId,
            targetUserId: contextOwner.userId,
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
      const { apiKey } = await withContext(prisma, contextOwner, async (tx) => {
        return createApiKey(tx, contextOwner, {
          name: "Owner Private Key",
        });
      });

      const initialDeniedCount = await getAuditEventCount("api_keys.revoke_any", "denied");

      // 2. Member without revoke_any (editor in workspace, admin in org) attempts to revoke owner's key
      // Wait: in guard, requireWorkspacePermission checks if user is admin in workspace
      // contextEditor is editor in workspace, not admin.
      await expect(
        withContext(prisma, contextEditor, async (tx) => {
          return revokeApiKey(tx, contextEditor, apiKey.id);
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
