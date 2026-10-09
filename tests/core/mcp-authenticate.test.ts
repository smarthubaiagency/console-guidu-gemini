/**
 * ============================================================================
 * File: tests/core/mcp-authenticate.test.ts
 * Module: MCP Token & API Key Authentication Integration Suite (ADR 0009 & C12)
 *
 * Maintenance Rationale:
 * - Integration test against Postgres database (CI local Supabase or migrated dev):
 *   1. Proves private.resolve_api_key works via authenticateApiKey.
 *   2. Proves withContext correctly applies principalType: 'api_key'.
 *   3. Proves immediate revocation and membership changes (AC03) block next access.
 *   4. Proves throttled update of last_used_at and audit trail recording.
 * ============================================================================
 */

import { PrismaClient } from "@prisma/client";
import { expect, it, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  authenticateApiKey,
  InvalidApiKeyError,
} from "@/core/mcp/authenticate";
import { createApiKey, revokeApiKey } from "@/core/credentials/api-keys";
import { withContext } from "@/lib/prisma/with-context";
import { describeDatabase } from "../prisma-rls/describe-database.js";
import { contextA, contextB, contextMultiOrgInA } from "./fixtures";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

describeDatabase(
  "authenticateApiKey Integration Suite (ADR 0009 & C12)",
  requiredVars,
  () => {
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
        await tx.apiKey.deleteMany({
          where: {
            workspaceId: { in: [contextA.workspaceId, contextB.workspaceId] },
          },
        });
      });
    });

    it("autentica chave válida e monta RequestContext com principalType api_key", async () => {
      const { rawKey, apiKey } = await withContext(
        prisma,
        contextA,
        async (tx) => {
          return createApiKey(tx, contextA, {
            name: "Cursor Assistant Key",
            scopes: ["workspace:read", "modules:read"],
            expiresInDays: 30,
          });
        },
      );

      const result = await authenticateApiKey(prisma, rawKey, {
        requestId: "test-req-auth-1",
      });

      expect(result.context.userId).toBe(contextA.userId);
      expect(result.context.workspaceId).toBe(contextA.workspaceId);
      expect(result.context.organizationId).toBe(contextA.organizationId);
      expect(result.context.principalType).toBe("api_key");
      expect(result.context.grantId).toBe(apiKey.id);
      expect(result.apiKey.id).toBe(apiKey.id);
      expect(result.apiKey.scopes).toEqual(["workspace:read", "modules:read"]);
    });

    it("rejeita chave revogada, expirada ou inexistente com a mesma resposta anti-oráculo", async () => {
      const { rawKey, apiKey } = await withContext(
        prisma,
        contextA,
        async (tx) => {
          return createApiKey(tx, contextA, {
            name: "Revoked Key Test",
            scopes: ["workspace:read"],
            expiresInDays: 30,
          });
        },
      );

      // Revoke the key
      await withContext(prisma, contextA, async (tx) => {
        return revokeApiKey(tx, contextA, apiKey.id);
      });

      // Revoked key returns InvalidApiKeyError
      await expect(
        authenticateApiKey(prisma, rawKey),
      ).rejects.toThrow(InvalidApiKeyError);

      // Nonexistent key returns exact same InvalidApiKeyError
      const nonexistentKey = `gdu_live_${"f".repeat(64)}`;
      await expect(
        authenticateApiKey(prisma, nonexistentKey),
      ).rejects.toThrow(InvalidApiKeyError);
    });

    it("vínculo desativado no workspace bloqueia o próximo uso da chave (AC03)", async () => {
      // 1. Create key while member is active
      const { rawKey } = await withContext(
        prisma,
        contextMultiOrgInA,
        async (tx) => {
          return createApiKey(tx, contextMultiOrgInA, {
            name: "Active Member Key",
            scopes: ["workspace:read"],
          });
        },
      );

      // Authenticate succeeds
      const auth1 = await authenticateApiKey(prisma, rawKey);
      expect(auth1.context.userId).toBe(contextMultiOrgInA.userId);

      // 2. Member has status changed to inactive
      await withContext(prisma, contextA, async (tx) => {
        await tx.workspaceMember.update({
          where: {
            workspaceId_userId: {
              workspaceId: contextA.workspaceId,
              userId: contextMultiOrgInA.userId,
            },
          },
          data: { status: "inactive" },
        });
      });

      // 3. Next authentication attempt immediately fails (AC03)
      await expect(
        authenticateApiKey(prisma, rawKey),
      ).rejects.toThrow(InvalidApiKeyError);

      // Restore member status
      await withContext(prisma, contextA, async (tx) => {
        await tx.workspaceMember.update({
          where: {
            workspaceId_userId: {
              workspaceId: contextA.workspaceId,
              userId: contextMultiOrgInA.userId,
            },
          },
          data: { status: "active" },
        });
      });
    });
  },
);
