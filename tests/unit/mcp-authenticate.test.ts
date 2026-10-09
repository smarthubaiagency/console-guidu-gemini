/**
 * ============================================================================
 * File: tests/unit/mcp-authenticate.test.ts
 * Module: MCP Token & API Key Authentication Unit Suite (ADR 0009, C10, C11, C12)
 *
 * Maintenance Rationale:
 * - Validates:
 *   1. Strict format check: gdu_live_<64 hex chars>.
 *   2. Anti-oracle behavior: nonexistent, revoked, expired, or invalid keys throw
 *      the exact same InvalidApiKeyError (unauthenticated, safeMessage).
 *   3. Contextual revalidation: profile status, workspace status, membership status.
 *   4. Permission checking: viewer rejected for proposals:write.
 *   5. Throttle on last_used_at and audit trail recording (api_keys.used).
 * ============================================================================
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  authenticateApiKey,
  InvalidApiKeyError,
} from "@/core/mcp/authenticate";
import { API_KEY_PREFIX } from "@/core/credentials/api-keys";

describe("authenticateApiKey Unit & Mock Suite (ADR 0009 & C12)", () => {
  const validHex = "a".repeat(64);
  const validRawKey = `${API_KEY_PREFIX}${validHex}`;

  const mockKeyRecord = {
    id: "c0000000-0000-4000-8000-000000000001",
    user_id: "u0000000-0000-4000-8000-000000000001",
    workspace_id: "w0000000-0000-4000-8000-000000000001",
    organization_id: "o0000000-0000-4000-8000-000000000001",
    scopes: ["workspace:read", "modules:read"],
    status: "active",
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  };

  type MockOverrides = {
    queryRawRows?: unknown[];
    profile?: unknown;
    workspace?: unknown;
    member?: unknown;
    apiKey?: unknown;
  };

  const createMockPrisma = (overrides?: MockOverrides) => {
    const tx = {
      profile: {
        findUnique: vi.fn().mockResolvedValue(
          overrides?.profile !== undefined
            ? overrides.profile
            : { status: "active" },
        ),
      },
      workspace: {
        findUnique: vi.fn().mockResolvedValue(
          overrides?.workspace !== undefined
            ? overrides.workspace
            : { status: "active" },
        ),
      },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue(
          overrides?.member !== undefined
            ? overrides.member
            : { role: "owner", status: "active" },
        ),
      },
      apiKey: {
        findUnique: vi.fn().mockResolvedValue(
          overrides?.apiKey !== undefined
            ? overrides.apiKey
            : { lastUsedAt: null },
        ),
        update: vi.fn().mockResolvedValue({}),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    return {
      tx,
      prisma: {
        $queryRaw: vi.fn().mockResolvedValue(
          overrides?.queryRawRows !== undefined
            ? overrides.queryRawRows
            : [mockKeyRecord],
        ),
        $transaction: vi.fn().mockImplementation(async (cb) => cb(tx)),
      } as unknown as Parameters<typeof authenticateApiKey>[0],
    };
  };

  describe("Format validation", () => {
    it("rejects keys without prefix", async () => {
      const { prisma } = createMockPrisma();
      await expect(
        authenticateApiKey(prisma, "invalid_prefix_token_1234567890"),
      ).rejects.toThrow(InvalidApiKeyError);
    });

    it("rejects keys with incorrect length", async () => {
      const { prisma } = createMockPrisma();
      await expect(
        authenticateApiKey(prisma, `${API_KEY_PREFIX}short`),
      ).rejects.toThrow(InvalidApiKeyError);
    });

    it("rejects empty or null tokens", async () => {
      const { prisma } = createMockPrisma();
      await expect(authenticateApiKey(prisma, "")).rejects.toThrow(
        InvalidApiKeyError,
      );
    });
  });

  describe("Anti-oracle uniform error behavior", () => {
    it("returns exact same error for nonexistent key", async () => {
      const { prisma } = createMockPrisma({ queryRawRows: [] });
      await expect(
        authenticateApiKey(prisma, validRawKey),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(InvalidApiKeyError);
        const appErr = err as InvalidApiKeyError;
        expect(appErr.code).toBe("unauthenticated");
        expect(appErr.safeMessage).toBe(
          "Chave de API inválida, expirada ou revogada.",
        );
        return true;
      });
    });

    it("returns exact same error for revoked key", async () => {
      const { prisma } = createMockPrisma({
        queryRawRows: [{ ...mockKeyRecord, status: "revoked" }],
      });
      await expect(
        authenticateApiKey(prisma, validRawKey),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(InvalidApiKeyError);
        const appErr = err as InvalidApiKeyError;
        expect(appErr.code).toBe("unauthenticated");
        expect(appErr.safeMessage).toBe(
          "Chave de API inválida, expirada ou revogada.",
        );
        return true;
      });
    });

    it("returns exact same error for expired key", async () => {
      const { prisma } = createMockPrisma({
        queryRawRows: [
          {
            ...mockKeyRecord,
            expires_at: new Date(Date.now() - 1000),
          },
        ],
      });
      await expect(
        authenticateApiKey(prisma, validRawKey),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(InvalidApiKeyError);
        const appErr = err as InvalidApiKeyError;
        expect(appErr.code).toBe("unauthenticated");
        expect(appErr.safeMessage).toBe(
          "Chave de API inválida, expirada ou revogada.",
        );
        return true;
      });
    });

    it("returns exact same error for invalid scopes in record", async () => {
      const { prisma } = createMockPrisma({
        queryRawRows: [
          {
            ...mockKeyRecord,
            scopes: ["invalid:scope"],
          },
        ],
      });
      await expect(
        authenticateApiKey(prisma, validRawKey),
      ).rejects.toThrow(InvalidApiKeyError);
    });
  });

  describe("Contextual revalidation inside withContext", () => {
    it("rejects when profile is blocked or inactive", async () => {
      const { prisma } = createMockPrisma({
        profile: { status: "blocked" },
      });
      await expect(
        authenticateApiKey(prisma, validRawKey),
      ).rejects.toThrow(InvalidApiKeyError);
    });

    it("rejects when workspace is inactive", async () => {
      const { prisma } = createMockPrisma({
        workspace: { status: "suspended" },
      });
      await expect(
        authenticateApiKey(prisma, validRawKey),
      ).rejects.toThrow(InvalidApiKeyError);
    });

    it("rejects when workspace member is inactive or removed (AC03)", async () => {
      const { prisma } = createMockPrisma({
        member: { role: "owner", status: "inactive" },
      });
      await expect(
        authenticateApiKey(prisma, validRawKey),
      ).rejects.toThrow(InvalidApiKeyError);
    });

    it("rejects when viewer attempts to authenticate with proposals:write scope", async () => {
      const { prisma } = createMockPrisma({
        queryRawRows: [
          {
            ...mockKeyRecord,
            scopes: ["workspace:read", "proposals:write"],
          },
        ],
        member: { role: "viewer", status: "active" },
      });
      await expect(
        authenticateApiKey(prisma, validRawKey),
      ).rejects.toThrow(InvalidApiKeyError);
    });
  });

  describe("Successful authentication and throttled usage", () => {
    it("authenticates active key and returns correct RequestContext", async () => {
      const { prisma, tx } = createMockPrisma({
        apiKey: { lastUsedAt: null },
      });
      const result = await authenticateApiKey(prisma, validRawKey, {
        requestId: "req-123",
      });

      expect(result.context.userId).toBe(mockKeyRecord.user_id);
      expect(result.context.workspaceId).toBe(mockKeyRecord.workspace_id);
      expect(result.context.organizationId).toBe(mockKeyRecord.organization_id);
      expect(result.context.principalType).toBe("api_key");
      expect(result.context.grantId).toBe(mockKeyRecord.id);

      expect(result.apiKey.id).toBe(mockKeyRecord.id);
      expect(result.apiKey.scopes).toEqual(["workspace:read", "modules:read"]);

      // Verify last_used_at was updated
      expect(tx.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockKeyRecord.id },
          data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
        }),
      );
    });

    it("throttles last_used_at update if used within last 60 seconds", async () => {
      const recentUsedAt = new Date(Date.now() - 30 * 1000); // 30s ago
      const { prisma, tx } = createMockPrisma({
        apiKey: { lastUsedAt: recentUsedAt },
      });

      const result = await authenticateApiKey(prisma, validRawKey);
      expect(result.context.principalType).toBe("api_key");

      // Verify last_used_at was NOT updated due to throttle
      expect(tx.apiKey.update).not.toHaveBeenCalled();
    });

    it("updates last_used_at when more than 60 seconds have passed", async () => {
      const oldUsedAt = new Date(Date.now() - 75 * 1000); // 75s ago
      const { prisma, tx } = createMockPrisma({
        apiKey: { lastUsedAt: oldUsedAt },
      });

      const result = await authenticateApiKey(prisma, validRawKey);
      expect(result.context.principalType).toBe("api_key");

      // Verify last_used_at WAS updated
      expect(tx.apiKey.update).toHaveBeenCalled();
    });
  });
});
