/**
 * ============================================================================
 * File: src/core/mcp/authenticate.ts
 * Module: MCP Token & API Key Authentication (ADR 0009, Spec §15, §17.3, C10, C11)
 *
 * Maintenance Rationale:
 * - Implements ADR 0009:
 *   - Personal API keys (tokens) replace OAuth as primary MCP authentication.
 *   - Key lookup by SHA-256 hash via SECURITY DEFINER function `private.resolve_api_key`.
 *   - Anti-oracle unified error response: revoked, expired, nonexistent, or invalid format
 *     keys return the exact same error response without timing or message differentiation.
 *   - Real-time revalidation: inside `withContext`, re-checks profile status ('active'),
 *     workspace status ('active'), workspace membership status ('active') and RBAC
 *     permission compatibility with scopes (AC03).
 *   - Updates `last_used_at` and records `api_keys.used` in audit trail throttled to
 *     at most once per minute per key.
 *   - Never logs raw API keys.
 * ============================================================================
 */

import "server-only";

import type { PrismaClient } from "@prisma/client";
import { API_KEY_PREFIX, hashApiKey } from "@/core/credentials/api-keys";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors/app-error";
import { recordAudit } from "@/core/audit/record";
import {
  WorkspaceScopeSchema,
  type WorkspaceScopeType,
} from "./scopes";
import { hasWorkspaceRolePermission } from "@/core/permissions/matrix";
import { Permissions } from "@/core/permissions/catalog";
import type { WorkspaceRole } from "@/core/permissions/roles";

export class InvalidApiKeyError extends AppError {
  constructor(requestId?: string) {
    super({
      code: "unauthenticated",
      safeMessage: "Chave de API inválida, expirada ou revogada.",
      ...(requestId ? { requestId } : {}),
    });
    this.name = "InvalidApiKeyError";
  }
}

export type AuthenticateApiKeyOptions = {
  requestId?: string;
};

export type AuthenticatedApiKeyResult = {
  context: RequestContext;
  apiKey: {
    id: string;
    userId: string;
    workspaceId: string;
    organizationId: string;
    scopes: WorkspaceScopeType[];
    status: string;
    expiresAt: Date;
  };
};

type ResolveApiKeyRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  organization_id: string;
  scopes: string[];
  status: string;
  expires_at: Date;
};

const LAST_USED_THROTTLE_MS = 60 * 1000; // 1 minute throttle to prevent write amplification

/**
 * Validates a raw platform API key and establishes a verified `RequestContext`.
 *
 * @param prisma PrismaClient instance
 * @param rawKey Plaintext API key token provided by the client
 * @param options Optional correlation metadata (requestId)
 * @returns Authenticated context and key metadata
 * @throws InvalidApiKeyError for any format, lookup, state, or permission mismatch
 */
export async function authenticateApiKey(
  prisma: PrismaClient,
  rawKey: string,
  options?: AuthenticateApiKeyOptions,
): Promise<AuthenticatedApiKeyResult> {
  const requestId = options?.requestId;

  // 1. Format validation (gdu_live_<64 hex chars>)
  if (
    !rawKey ||
    typeof rawKey !== "string" ||
    !rawKey.startsWith(API_KEY_PREFIX) ||
    rawKey.length !== API_KEY_PREFIX.length + 64
  ) {
    throw new InvalidApiKeyError(requestId);
  }

  // 2. Hash computation
  const keyHash = hashApiKey(rawKey);

  // 3. Secure lookup without prior workspace context via private.resolve_api_key
  let rows: ResolveApiKeyRow[];
  try {
    rows = await prisma.$queryRaw<ResolveApiKeyRow[]>`
      select id, user_id, workspace_id, organization_id, scopes, status, expires_at
      from private.resolve_api_key(${keyHash})
    `;
  } catch {
    throw new InvalidApiKeyError(requestId);
  }

  const keyRecord = rows[0];
  if (!keyRecord) {
    throw new InvalidApiKeyError(requestId);
  }

  // 4. Status and expiration verification (anti-oracle: exact same error)
  if (keyRecord.status !== "active") {
    throw new InvalidApiKeyError(requestId);
  }

  const expiresAt = new Date(keyRecord.expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    throw new InvalidApiKeyError(requestId);
  }

  // 5. Scope validation against canonical §17.3 catalog
  const validatedScopes: WorkspaceScopeType[] = [];
  if (!Array.isArray(keyRecord.scopes) || keyRecord.scopes.length === 0) {
    throw new InvalidApiKeyError(requestId);
  }

  for (const s of keyRecord.scopes) {
    const parsed = WorkspaceScopeSchema.safeParse(s);
    if (!parsed.success) {
      throw new InvalidApiKeyError(requestId);
    }
    validatedScopes.push(parsed.data);
  }

  // 6. Assemble RequestContext with principalType: "api_key"
  const context: RequestContext = {
    userId: keyRecord.user_id,
    workspaceId: keyRecord.workspace_id,
    organizationId: keyRecord.organization_id,
    principalType: "api_key",
    grantId: keyRecord.id,
  };

  // 7. Within withContext: revalidate identity, membership, workspace, and scope permissions
  await withContext(prisma, context, async (tx) => {
    // 7a. Revalidate user profile status
    const profile = await tx.profile.findUnique({
      where: { id: context.userId },
      select: { status: true },
    });
    if (!profile || profile.status !== "active") {
      throw new InvalidApiKeyError(requestId);
    }

    // 7b. Revalidate workspace status
    const workspace = await tx.workspace.findUnique({
      where: { id: context.workspaceId },
      select: { status: true },
    });
    if (!workspace || workspace.status !== "active") {
      throw new InvalidApiKeyError(requestId);
    }

    // 7c. Revalidate active workspace membership (AC03)
    const member = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: context.workspaceId,
          userId: context.userId,
        },
      },
      select: { role: true, status: true },
    });
    if (!member || member.status !== "active") {
      throw new InvalidApiKeyError(requestId);
    }

    // 7d. Revalidate scope compatibility with workspace role & permission matrix
    const role = member.role as WorkspaceRole;
    for (const scope of validatedScopes) {
      if (
        scope === "workspace:read" ||
        scope === "modules:read" ||
        scope === "usage:read" ||
        scope === "executions:read"
      ) {
        if (!hasWorkspaceRolePermission(role, Permissions.WORKSPACE_READ)) {
          throw new InvalidApiKeyError(requestId);
        }
      } else if (scope === "members:read") {
        if (!hasWorkspaceRolePermission(role, Permissions.WORKSPACE_MEMBERS_READ)) {
          throw new InvalidApiKeyError(requestId);
        }
      } else if (scope === "proposals:write") {
        // Viewer role has strictly read-only access (C06 / C12)
        if (role === "viewer") {
          throw new InvalidApiKeyError(requestId);
        }
      }
    }

    // 7e. Throttled update of last_used_at and audit recording (at most 1 per minute)
    const currentKey = await tx.apiKey.findUnique({
      where: { id: keyRecord.id },
      select: { lastUsedAt: true },
    });

    const now = new Date();
    const shouldUpdateLastUsed =
      !currentKey?.lastUsedAt ||
      now.getTime() - currentKey.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS;

    if (shouldUpdateLastUsed) {
      await tx.apiKey.update({
        where: { id: keyRecord.id },
        data: { lastUsedAt: now },
      });

      await recordAudit(tx, context, {
        action: "api_keys.used",
        resourceType: "api_key",
        resourceId: keyRecord.id,
        result: "success",
        origin: "mcp",
        ...(requestId ? { requestId } : {}),
        metadata: {
          scopes: validatedScopes,
        },
      });
    }
  });

  return {
    context,
    apiKey: {
      id: keyRecord.id,
      userId: keyRecord.user_id,
      workspaceId: keyRecord.workspace_id,
      organizationId: keyRecord.organization_id,
      scopes: validatedScopes,
      status: keyRecord.status,
      expiresAt,
    },
  };
}
