/**
 * ============================================================================
 * File: src/core/credentials/api-keys.ts
 * Module: Platform API Keys & MCP Token Authentication (ADR 0009)
 *
 * Maintenance Rationale:
 * - Implements ADR 0009: Personal API tokens replace OAuth as primary MCP authentication.
 * - Each key is scoped to a user, a workspace, and explicit permissions.
 * - Stored exclusively as SHA-256 hash. The plaintext key is returned once upon creation.
 * - Mandatory expiration and immediate revocation on request.
 * - Key format: `gdu_live_<64_hex_chars>`.
 * ============================================================================
 */

import crypto from "node:crypto";
import type { ContextTransaction } from "@/lib/prisma/with-context";

export const API_KEY_PREFIX = "gdu_live_";

export type ApiKeyItem = {
  id: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: "active" | "revoked";
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Computes deterministic SHA-256 hash of a platform API key.
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Generates a high-entropy API key using CSPRNG.
 */
export function generateApiKey(): { rawKey: string; keyHash: string; prefix: string } {
  const entropy = crypto.randomBytes(32).toString("hex");
  const rawKey = `${API_KEY_PREFIX}${entropy}`;
  const keyHash = hashApiKey(rawKey);
  const prefix = `${API_KEY_PREFIX}${entropy.substring(0, 6)}...`;

  return { rawKey, keyHash, prefix };
}

/**
 * Creates a platform API key with mandatory expiration and explicit scopes (ADR 0009).
 */
export async function createApiKey(
  tx: ContextTransaction,
  params: {
    organizationId: string;
    workspaceId: string;
    userId: string;
    name: string;
    scopes?: string[];
    expiresInDays?: number;
  },
): Promise<{ apiKey: ApiKeyItem; rawKey: string }> {
  const {
    organizationId,
    workspaceId,
    userId,
    name,
    scopes = ["read"],
    expiresInDays = 90,
  } = params;

  if (!name || name.trim().length === 0) {
    throw new Error("API key name is required");
  }

  const { rawKey, keyHash, prefix } = generateApiKey();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const record = await tx.apiKey.create({
    data: {
      organizationId,
      workspaceId,
      userId,
      name: name.trim(),
      prefix,
      keyHash,
      scopes,
      status: "active",
      expiresAt,
    },
  });

  return {
    apiKey: {
      id: record.id,
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      name: record.name,
      prefix: record.prefix,
      scopes: record.scopes,
      status: record.status as "active" | "revoked",
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    rawKey,
  };
}

/**
 * Lists API keys for a workspace.
 */
export async function listApiKeys(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<ApiKeyItem[]> {
  const records = await tx.apiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });

  return records.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    workspaceId: r.workspaceId,
    userId: r.userId,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    status: r.status as "active" | "revoked",
    expiresAt: r.expiresAt,
    lastUsedAt: r.lastUsedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Immediately revokes an API key.
 */
export async function revokeApiKey(
  tx: ContextTransaction,
  apiKeyId: string,
): Promise<ApiKeyItem> {
  const updated = await tx.apiKey.update({
    where: { id: apiKeyId },
    data: { status: "revoked" },
  });

  return {
    id: updated.id,
    organizationId: updated.organizationId,
    workspaceId: updated.workspaceId,
    userId: updated.userId,
    name: updated.name,
    prefix: updated.prefix,
    scopes: updated.scopes,
    status: updated.status as "active" | "revoked",
    expiresAt: updated.expiresAt,
    lastUsedAt: updated.lastUsedAt,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Validates a raw API key against stored hashes.
 */
export async function validateApiKey(
  tx: ContextTransaction,
  rawKey: string,
): Promise<{ valid: boolean; apiKey?: ApiKeyItem; reason?: string }> {
  if (!rawKey.startsWith(API_KEY_PREFIX)) {
    return { valid: false, reason: "invalid_format" };
  }

  const keyHash = hashApiKey(rawKey);
  const found = await tx.apiKey.findUnique({
    where: { keyHash },
  });

  if (!found) {
    return { valid: false, reason: "key_not_found" };
  }

  if (found.status === "revoked") {
    return { valid: false, reason: "key_revoked" };
  }

  if (found.expiresAt < new Date()) {
    return { valid: false, reason: "key_expired" };
  }

  // Record last used timestamp
  await tx.apiKey.update({
    where: { id: found.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    valid: true,
    apiKey: {
      id: found.id,
      organizationId: found.organizationId,
      workspaceId: found.workspaceId,
      userId: found.userId,
      name: found.name,
      prefix: found.prefix,
      scopes: found.scopes,
      status: found.status as "active" | "revoked",
      expiresAt: found.expiresAt,
      lastUsedAt: new Date(),
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
    },
  };
}
