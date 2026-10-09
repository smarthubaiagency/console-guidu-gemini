import { PrismaClient } from "@prisma/client";
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret, decryptSecret, maskSecret } from "@/core/credentials/crypto";
import {
  registerCredential,
  listWorkspaceCredentials,
  revokeCredential,
  resolveProviderSecret,
  CredentialNotFoundError,
  InvalidProviderError,
} from "@/core/credentials/vault";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
  API_KEY_PREFIX,
} from "@/core/credentials/api-keys";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { contextA, contextB, contextMultiOrgInA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const contextEditorInA = {
  userId: ids.userOrgOnly,
  workspaceId: contextA.workspaceId,
  organizationId: contextA.organizationId,
} as const;

describeDatabase("Task 06: AI Providers, BYOK Vault & Platform API Keys (ADR 0009, Spec §16 & C07)", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DIRECT_DATABASE_URL ??
          process.env.DATABASE_URL ??
          "",
      },
    },
  });

  beforeEach(async () => {
    await withContext(prisma, contextA, async (tx) => {
      await tx.credential.deleteMany({
        where: { workspaceId: { in: [contextA.workspaceId, contextB.workspaceId] } },
      });
      await tx.apiKey.deleteMany({
        where: { workspaceId: { in: [contextA.workspaceId, contextB.workspaceId] } },
      });
    });
  });

  afterAll(async () => {
    await withContext(prisma, contextA, async (tx) => {
      await tx.workspaceMember.deleteMany({
        where: {
          workspaceId: contextA.workspaceId,
          userId: ids.userOrgOnly,
        },
      });
    });
    await prisma.$disconnect();
  });

  describe("Cryptographic Engine (AES-256-GCM)", () => {
    it("encrypts and decrypts secrets with complete fidelity", () => {
      const originalSecret = "sk-proj-super-secret-openai-api-key-1234567890";
      const { encryptedPayload, maskedValue } = encryptSecret(originalSecret);

      expect(encryptedPayload).not.toContain(originalSecret);
      expect(maskedValue).toBe("sk-...7890");

      const decrypted = decryptSecret(encryptedPayload);
      expect(decrypted).toBe(originalSecret);
    });

    it("detects payload tampering and rejects decryption", () => {
      const { encryptedPayload } = encryptSecret("test-secret-value");
      const parsed = JSON.parse(encryptedPayload);
      // Tamper ciphertext
      parsed.data = parsed.data.substring(0, parsed.data.length - 2) + "00";

      expect(() => decryptSecret(JSON.stringify(parsed))).toThrow();
    });

    it("masks secrets safely according to provider prefix", () => {
      expect(maskSecret("sk-1234567890abcdef")).toBe("sk-...cdef");
      expect(maskSecret("AIzaSyD1234567890wxyz")).toBe("AIza...wxyz");
      expect(maskSecret("short")).toBe("***");
    });
  });

  describe("BYOK Credential Vault (Spec §16 & C07)", () => {
    it("registers and lists credentials with masked values under withContext", async () => {
      const secret = "sk-proj-test-openai-key-abcde12345";

      const created = await withContext(prisma, contextA, async (tx) => {
        return registerCredential(tx, contextA, {
          provider: "openai",
          label: "Test OpenAI Vault",
          secret,
          purpose: "chat",
        });
      });

      expect(created.id).toBeDefined();
      expect(created.maskedValue).toBe("sk-...2345");
      expect(created.status).toBe("active");

      // List credentials for workspace A
      const listA = await withContext(prisma, contextA, async (tx) => {
        return listWorkspaceCredentials(tx, contextA);
      });

      const found = listA.find((c) => c.id === created.id);
      expect(found).toBeDefined();
      expect(found?.label).toBe("Test OpenAI Vault");

      // Verify cross-workspace isolation (AC01): Workspace B sees nothing from Workspace A
      const listB = await withContext(prisma, contextB, async (tx) => {
        return listWorkspaceCredentials(tx, contextB);
      });
      expect(listB.find((c) => c.id === created.id)).toBeUndefined();
    });

    it("resolves and decrypts the active raw secret exclusively on the server", async () => {
      const secret = "sk-proj-resolve-test-99887766";

      await withContext(prisma, contextA, async (tx) => {
        await registerCredential(tx, contextA, {
          provider: "openai",
          label: "Resolve Credential Test",
          secret,
          purpose: "all",
        });

        const resolved = await resolveProviderSecret(tx, contextA, "openai");
        expect(resolved).toBe(secret);
      });
    });

    it("throws CredentialNotFoundError when provider is not configured", async () => {
      await withContext(prisma, contextA, async (tx) => {
        await expect(
          resolveProviderSecret(tx, contextA, "gemini"),
        ).rejects.toThrow(CredentialNotFoundError);
      });
    });

    it("refuses unsupported provider identifiers", async () => {
      await withContext(prisma, contextA, async (tx) => {
        await expect(
          registerCredential(tx, contextA, {
            // @ts-expect-error test unsupported provider
            provider: "unknown-ai",
            label: "Invalid Provider",
            secret: "any-secret-12345",
          }),
        ).rejects.toThrow(InvalidProviderError);
      });
    });

    it("revokes credentials and stops resolution immediately", async () => {
      await withContext(prisma, contextA, async (tx) => {
        const cred = await registerCredential(tx, contextA, {
          provider: "anthropic",
          label: "Revocation Candidate",
          secret: "sk-ant-test-key-5544332211",
          purpose: "all",
        });

        const revoked = await revokeCredential(tx, contextA, cred.id);
        expect(revoked.status).toBe("revoked");

        await expect(
          resolveProviderSecret(tx, contextA, "anthropic"),
        ).rejects.toThrow(CredentialNotFoundError);
      });
    });
  });

  describe("Platform API Keys & MCP Token Authentication (ADR 0009 & C07)", () => {
    it("generates API keys formatted with gdu_live_ prefix and saves only SHA-256 hash", async () => {
      const result = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "MCP Client Cursor",
          scopes: ["workspace:read", "modules:read"],
          expiresInDays: 60,
        });
      });

      expect(result.rawKey.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(result.apiKey.name).toBe("MCP Client Cursor");
      expect(result.apiKey.scopes).toEqual(["workspace:read", "modules:read"]);
      expect(result.apiKey.status).toBe("active");
      expect(result.apiKey.userId).toBe(contextA.userId);

      // Verify database row does NOT contain the rawKey
      const rawInRow = await withContext(prisma, contextA, async (tx) => {
        const item = await tx.apiKey.findUnique({
          where: { id: result.apiKey.id },
        });
        return item?.keyHash;
      });

      expect(rawInRow).not.toBe(result.rawKey);
      expect(rawInRow?.length).toBe(64); // SHA-256 hex string length
    });

    it("validates an active API key and records last_used_at timestamp", async () => {
      const { rawKey, apiKey } = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "Validation Test Key",
          scopes: ["workspace:read", "modules:read"],
          expiresInDays: 30,
        });
      });

      const validation = await withContext(prisma, contextA, async (tx) => {
        return validateApiKey(tx, rawKey);
      });

      expect(validation.valid).toBe(true);
      expect(validation.apiKey?.id).toBe(apiKey.id);
      expect(validation.apiKey?.lastUsedAt).toBeInstanceOf(Date);
    });

    it("rejects unknown or invalid API keys", async () => {
      const fakeKey = `${API_KEY_PREFIX}0000000000000000000000000000000000000000000000000000000000000000`;

      const validation = await withContext(prisma, contextA, async (tx) => {
        return validateApiKey(tx, fakeKey);
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe("key_not_found");
    });

    it("immediately revokes an API key and blocks validation", async () => {
      const { rawKey, apiKey } = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "Revocation Key",
          scopes: ["workspace:read", "modules:read"],
          expiresInDays: 30,
        });
      });

      // Revoke key
      await withContext(prisma, contextA, async (tx) => {
        await revokeApiKey(tx, contextA, apiKey.id);
      });

      // Validation should now fail
      const validation = await withContext(prisma, contextA, async (tx) => {
        return validateApiKey(tx, rawKey);
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe("key_revoked");
    });

    it("enforces cross-workspace isolation on API keys (AC01)", async () => {
      const { apiKey } = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "Isolation Key A",
          scopes: ["workspace:read", "modules:read"],
        });
      });

      const listB = await withContext(prisma, contextB, async (tx) => {
        return listApiKeys(tx, contextB);
      });

      expect(listB.find((k) => k.id === apiKey.id)).toBeUndefined();
    });

    it("rejects invalid scopes that violate database check constraint", async () => {
      await withContext(prisma, contextA, async (tx) => {
        await expect(
          createApiKey(tx, contextA, {
            name: "Invalid Scope Key",
            scopes: ["read"],
          }),
        ).rejects.toThrow();

        await expect(
          createApiKey(tx, contextA, {
            name: "Admin Scope Key",
            scopes: ["admin:customers:read"],
          }),
        ).rejects.toThrow();

        await expect(
          createApiKey(tx, contextA, {
            name: "Empty Scope Key",
            scopes: [],
          }),
        ).rejects.toThrow();
      });
    });

    it("rejects expiration exceeding 365 days", async () => {
      await withContext(prisma, contextA, async (tx) => {
        await expect(
          createApiKey(tx, contextA, {
            name: "Over-expired Key",
            scopes: ["workspace:read"],
            expiresInDays: 400,
          }),
        ).rejects.toThrow();
      });
    });
  });

  describe("Permission Guards & RBAC Enforcement (C07)", () => {
    beforeEach(async () => {
      // Ensure editor membership for userOrgOnly in workspace A during RBAC checks
      await withContext(prisma, contextA, async (tx) => {
        await tx.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: contextA.workspaceId,
              userId: ids.userOrgOnly,
            },
          },
          update: { role: "editor", status: "active" },
          create: {
            workspaceId: contextA.workspaceId,
            organizationId: contextA.organizationId,
            userId: ids.userOrgOnly,
            role: "editor",
            status: "active",
          },
        });
      });
    });

    afterAll(async () => {
      // Clean up auxiliary membership so other test files (e.g. isolation.test.ts) see pristine fixture state
      await withContext(prisma, contextA, async (tx) => {
        await tx.workspaceMember.deleteMany({
          where: {
            workspaceId: contextA.workspaceId,
            userId: ids.userOrgOnly,
          },
        });
      });
    });

    it("viewer não cadastra nem revoga credencial; admin sim", async () => {
      // 1. Viewer trying to register credential -> rejected with PermissionDeniedError
      await withContext(prisma, contextMultiOrgInA, async (tx) => {
        await expect(
          registerCredential(tx, contextMultiOrgInA, {
            provider: "openai",
            label: "Viewer Attempt",
            secret: "sk-proj-viewer-attempt-12345",
          }),
        ).rejects.toThrow(PermissionDeniedError);
      });

      // 2. Admin registers credential successfully
      const adminCred = await withContext(prisma, contextA, async (tx) => {
        return registerCredential(tx, contextA, {
          provider: "openai",
          label: "Admin Allowed Key",
          secret: "sk-proj-admin-allowed-12345",
        });
      });
      expect(adminCred.id).toBeDefined();

      // 3. Viewer trying to revoke credential -> rejected with PermissionDeniedError
      await withContext(prisma, contextMultiOrgInA, async (tx) => {
        await expect(
          revokeCredential(tx, contextMultiOrgInA, adminCred.id),
        ).rejects.toThrow(PermissionDeniedError);
      });

      // 4. Admin revokes credential successfully
      const revoked = await withContext(prisma, contextA, async (tx) => {
        return revokeCredential(tx, contextA, adminCred.id);
      });
      expect(revoked.status).toBe("revoked");
    });

    it("editor não revoga a chave de outro usuário; revoga a própria; admin revoga qualquer uma", async () => {
      // 1. Admin creates key
      const adminKey = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "Admin Key",
          scopes: ["workspace:read", "modules:read"],
        });
      });

      // 2. Editor creates own key
      const editorKey = await withContext(prisma, contextEditorInA, async (tx) => {
        return createApiKey(tx, contextEditorInA, {
          name: "Editor Own Key",
          scopes: ["workspace:read", "modules:read"],
        });
      });

      // 3. Editor attempts to revoke admin's key -> rejected with PermissionDeniedError
      await withContext(prisma, contextEditorInA, async (tx) => {
        await expect(
          revokeApiKey(tx, contextEditorInA, adminKey.apiKey.id),
        ).rejects.toThrow(PermissionDeniedError);
      });

      // 4. Editor revokes own key -> allowed
      const editorRevoked = await withContext(prisma, contextEditorInA, async (tx) => {
        return revokeApiKey(tx, contextEditorInA, editorKey.apiKey.id);
      });
      expect(editorRevoked.status).toBe("revoked");

      // 5. Editor creates another key
      const editorKey2 = await withContext(prisma, contextEditorInA, async (tx) => {
        return createApiKey(tx, contextEditorInA, {
          name: "Editor Key 2",
          scopes: ["workspace:read", "modules:read"],
        });
      });

      // 6. Admin revokes editor's key -> allowed (admin has api_keys.revoke_any)
      const adminRevoked = await withContext(prisma, contextA, async (tx) => {
        return revokeApiKey(tx, contextA, editorKey2.apiKey.id);
      });
      expect(adminRevoked.status).toBe("revoked");
    });

    it("membro sem read_all lista só as próprias chaves", async () => {
      // Create key as Admin
      await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, contextA, {
          name: "Admin Key for Listing",
          scopes: ["workspace:read", "modules:read"],
        });
      });

      // Create key as Editor
      const editorKey = await withContext(prisma, contextEditorInA, async (tx) => {
        return createApiKey(tx, contextEditorInA, {
          name: "Editor Key for Listing",
          scopes: ["workspace:read", "modules:read"],
        });
      });

      // Editor (without api_keys.read_all) sees ONLY their own keys
      const editorList = await withContext(prisma, contextEditorInA, async (tx) => {
        return listApiKeys(tx, contextEditorInA);
      });
      expect(editorList.length).toBe(1);
      expect(editorList[0]?.id).toBe(editorKey.apiKey.id);
      expect(editorList[0]?.userId).toBe(contextEditorInA.userId);

      // Admin (with api_keys.read_all) sees ALL keys in workspace
      const adminList = await withContext(prisma, contextA, async (tx) => {
        return listApiKeys(tx, contextA);
      });
      expect(adminList.length).toBeGreaterThanOrEqual(2);
      expect(adminList.some((k) => k.userId === contextEditorInA.userId)).toBe(true);
      expect(adminList.some((k) => k.userId === contextA.userId)).toBe(true);
    });

    it("chave de outro workspace responde 'não encontrada'", async () => {
      // Key created in workspace B
      const keyB = await withContext(prisma, contextB, async (tx) => {
        return createApiKey(tx, contextB, {
          name: "Workspace B Key",
          scopes: ["workspace:read", "modules:read"],
        });
      });

      // Calling revokeApiKey from workspace A context with key B id
      await withContext(prisma, contextA, async (tx) => {
        await expect(
          revokeApiKey(tx, contextA, keyB.apiKey.id),
        ).rejects.toThrow("Chave de API não encontrada.");
      });
    });

    it("vínculo desativado no meio do teste perde o acesso na chamada seguinte (AC03)", async () => {
      // 1. Editor is active and creates key successfully
      const initialKey = await withContext(prisma, contextEditorInA, async (tx) => {
        return createApiKey(tx, contextEditorInA, {
          name: "Active Member Key",
          scopes: ["workspace:read", "modules:read"],
        });
      });
      expect(initialKey.apiKey.id).toBeDefined();

      // 2. Deactivate editor membership
      await withContext(prisma, contextA, async (tx) => {
        await tx.workspaceMember.update({
          where: {
            workspaceId_userId: {
              workspaceId: contextA.workspaceId,
              userId: ids.userOrgOnly,
            },
          },
          data: { status: "inactive" },
        });
      });

      // 3. Immediate subsequent calls fail with PermissionDeniedError (AC03)
      await withContext(prisma, contextEditorInA, async (tx) => {
        await expect(
          createApiKey(tx, contextEditorInA, { name: "Forbidden Key" }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
          listApiKeys(tx, contextEditorInA),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
          revokeApiKey(tx, contextEditorInA, initialKey.apiKey.id),
        ).rejects.toThrow(PermissionDeniedError);
      });
    });
  });
});
