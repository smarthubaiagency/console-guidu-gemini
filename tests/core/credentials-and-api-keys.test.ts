import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

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
import { withContext } from "@/lib/prisma/with-context";
import { contextA, contextB } from "./fixtures";

describe("Task 06: AI Providers, BYOK Vault & Platform API Keys (ADR 0009, Spec §16)", () => {
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

  describe("BYOK Credential Vault (Spec §16)", () => {
    it("registers and lists credentials with masked values under withContext", async () => {
      const secret = "sk-proj-test-openai-key-abcde12345";

      const created = await withContext(prisma, contextA, async (tx) => {
        return registerCredential(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
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
        return listWorkspaceCredentials(tx, contextA.workspaceId);
      });

      const found = listA.find((c) => c.id === created.id);
      expect(found).toBeDefined();
      expect(found?.label).toBe("Test OpenAI Vault");

      // Verify cross-workspace isolation (AC01): Workspace B sees nothing from Workspace A
      const listB = await withContext(prisma, contextB, async (tx) => {
        return listWorkspaceCredentials(tx, contextB.workspaceId);
      });
      expect(listB.find((c) => c.id === created.id)).toBeUndefined();
    });

    it("resolves and decrypts the active raw secret exclusively on the server", async () => {
      const secret = "sk-proj-resolve-test-99887766";

      await withContext(prisma, contextA, async (tx) => {
        await registerCredential(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
          provider: "openai",
          label: "Resolve Credential Test",
          secret,
          purpose: "all",
        });

        const resolved = await resolveProviderSecret(tx, contextA.workspaceId, "openai");
        expect(resolved).toBe(secret);
      });
    });

    it("throws CredentialNotFoundError when provider is not configured", async () => {
      await withContext(prisma, contextA, async (tx) => {
        await expect(
          resolveProviderSecret(tx, contextA.workspaceId, "gemini"),
        ).rejects.toThrow(CredentialNotFoundError);
      });
    });

    it("refuses unsupported provider identifiers", async () => {
      await withContext(prisma, contextA, async (tx) => {
        await expect(
          registerCredential(tx, {
            organizationId: contextA.organizationId,
            workspaceId: contextA.workspaceId,
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
        const cred = await registerCredential(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
          provider: "anthropic",
          label: "Revocation Candidate",
          secret: "sk-ant-test-key-5544332211",
          purpose: "all",
        });

        const revoked = await revokeCredential(tx, cred.id);
        expect(revoked.status).toBe("revoked");

        await expect(
          resolveProviderSecret(tx, contextA.workspaceId, "anthropic"),
        ).rejects.toThrow(CredentialNotFoundError);
      });
    });
  });

  describe("Platform API Keys & MCP Token Authentication (ADR 0009)", () => {
    it("generates API keys formatted with gdu_live_ prefix and saves only SHA-256 hash", async () => {
      const result = await withContext(prisma, contextA, async (tx) => {
        return createApiKey(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
          userId: contextA.userId,
          name: "MCP Client Cursor",
          scopes: ["read", "mcp:read"],
          expiresInDays: 60,
        });
      });

      expect(result.rawKey.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(result.apiKey.name).toBe("MCP Client Cursor");
      expect(result.apiKey.scopes).toEqual(["read", "mcp:read"]);
      expect(result.apiKey.status).toBe("active");

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
        return createApiKey(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
          userId: contextA.userId,
          name: "Validation Test Key",
          scopes: ["read"],
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
        return createApiKey(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
          userId: contextA.userId,
          name: "Revocation Key",
          scopes: ["read"],
          expiresInDays: 30,
        });
      });

      // Revoke key
      await withContext(prisma, contextA, async (tx) => {
        await revokeApiKey(tx, apiKey.id);
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
        return createApiKey(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
          userId: contextA.userId,
          name: "Isolation Key A",
          scopes: ["read"],
        });
      });

      const listB = await withContext(prisma, contextB, async (tx) => {
        return listApiKeys(tx, contextB.workspaceId);
      });

      expect(listB.find((k) => k.id === apiKey.id)).toBeUndefined();
    });
  });
});
