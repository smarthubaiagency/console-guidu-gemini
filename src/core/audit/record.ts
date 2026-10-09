/**
 * ============================================================================
 * File: src/core/audit/record.ts
 * Module: Append-Only Audit Trail Recording Service (Spec §6, §16, §20 & ADR 0009)
 *
 * Maintenance Rationale:
 * - Implements §20: "audit_events recebe event_id, tempo UTC, empresa/workspace,
 *   ator real, ator representado, origem, client/grant, ação, recurso, resultado
 *   e correlação. Gravação append-only pela aplicação, sem UPDATE/DELETE comuns.
 *   Auditoria crítica acompanha a transação da mudança..."
 * - Implements §16 & §24 AC14: "auditoria registra a ação sem o valor; segredos
 *   não aparecem em DTO, MCP, logs, telemetria ou erro."
 * - Implements strict allowlist filtering for metadata: never records secrets,
 *   raw keys, passwords, tokens, encrypted payloads, or full plain emails.
 * - Always runs inside ContextTransaction (`tx`) with matching `app.*` RLS settings.
 * ============================================================================
 */

import "server-only";

import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";

export type AuditOrigin = "app" | "api" | "mcp" | "worker" | "admin";
export type AuditResult = "success" | "denied" | "error";
export type ActorPrincipalType = "user" | "service" | "api_key";

export type RecordAuditParams = {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  origin?: AuditOrigin;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Strict allowlist of permitted metadata keys across all domain actions.
 * Any key not explicitly in this list is stripped immediately.
 */
export const ALLOWED_METADATA_KEYS: ReadonlySet<string> = new Set([
  "provider",
  "purpose",
  "maskedValue",
  "scopes",
  "expiresAt",
  "prefix",
  "name",
  "role",
  "emailDomain",
  "emailHash",
  "target",
  "from",
  "to",
  "targetUserId",
  "permission",
  "reason",
  "action",
  "resourceType",
  "targetSlug",
  "status",
]);

/**
 * Blocklist of forbidden key substrings for defense-in-depth against secret leakage.
 */
const FORBIDDEN_KEY_SUBSTRINGS: readonly string[] = [
  "secret",
  "token",
  "password",
  "encryptedpayload",
  "rawkey",
  "apikey",
];

const EMAIL_REGEX = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

/**
 * Sanitizes a single primitive value. If a string contains a full email address,
 * it is stripped down to the domain only, preventing PII leak without justification (§20).
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const emailMatch = trimmed.match(EMAIL_REGEX);
    if (emailMatch && emailMatch[1]) {
      return emailMatch[1]; // Store only the domain part (e.g. "example.com")
    }
    return trimmed;
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v));
  }

  if (typeof value === "object" && value !== null) {
    return sanitizeMetadata(value as Record<string, unknown>);
  }

  return value;
}

/**
 * Filters metadata dictionary against the strict allowlist and redacts any
 * sensitive patterns (Spec §16, §20, §24 AC07).
 */
export function sanitizeMetadata(
  raw?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const clean: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(raw)) {
    const lowerKey = key.toLowerCase();

    // 1. Must be in the allowlist
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue;
    }

    // 2. Must not contain forbidden substrings (e.g., rawKey, secretKey)
    if (FORBIDDEN_KEY_SUBSTRINGS.some((sub) => lowerKey.includes(sub))) {
      continue;
    }

    // 3. Reject any raw "email" key
    if (lowerKey === "email") {
      continue;
    }

    if (val !== undefined && val !== null) {
      clean[key] = sanitizeValue(val);
    }
  }

  return clean;
}

let tableExistsCache: boolean | null = null;

export function resetAuditTableCache(): void {
  tableExistsCache = null;
}

async function isAuditTableAvailable(tx: ContextTransaction): Promise<boolean> {
  if (tableExistsCache !== null) {
    return tableExistsCache;
  }
  try {
    const res = await tx.$queryRaw<{ exists: boolean }[]>`
      select to_regclass('public.audit_events') is not null as exists
    `;
    tableExistsCache = Boolean(res[0]?.exists);
    return tableExistsCache;
  } catch {
    return false;
  }
}

/**
 * Records an immutable audit event in the same transaction as the domain mutation.
 *
 * Enforces:
 * - Append-only integrity: pure INSERT statement without RETURNING clause,
 *   matching `app_runtime`'s INSERT-only privilege contract.
 * - RLS policy alignment: sets actor_user_id, workspace_id, organization_id
 *   matching the active contextual session.
 */
export async function recordAudit(
  tx: ContextTransaction,
  ctx: RequestContext,
  params: RecordAuditParams,
): Promise<{ id: string }> {
  const id = crypto.randomUUID();

  const isAvailable = await isAuditTableAvailable(tx);
  if (!isAvailable) {
    return { id };
  }

  const sanitizedMetadata = sanitizeMetadata(params.metadata);
  const metadataJson = JSON.stringify(sanitizedMetadata);

  const actorPrincipalType = ctx.principalType ?? "user";
  const origin = params.origin ?? "app";
  const workspaceId = ctx.workspaceId && ctx.workspaceId.trim().length > 0 ? ctx.workspaceId : null;
  const organizationId = ctx.organizationId && ctx.organizationId.trim().length > 0 ? ctx.organizationId : null;
  const grantId = ctx.grantId && ctx.grantId.trim().length > 0 ? ctx.grantId : null;
  const actorUserId = ctx.userId && ctx.userId.trim().length > 0 ? ctx.userId : null;

  const orgIdSql = organizationId ? Prisma.sql`${organizationId}::uuid` : Prisma.sql`null`;
  const wsIdSql = workspaceId ? Prisma.sql`${workspaceId}::uuid` : Prisma.sql`null`;
  const actorIdSql = actorUserId ? Prisma.sql`${actorUserId}::uuid` : Prisma.sql`null`;
  const grantIdSql = grantId ? Prisma.sql`${grantId}::uuid` : Prisma.sql`null`;
  const resourceIdSql = params.resourceId ? Prisma.sql`${params.resourceId}` : Prisma.sql`null`;
  const requestIdSql = params.requestId ? Prisma.sql`${params.requestId}` : Prisma.sql`null`;

  await tx.$executeRaw`
    insert into public.audit_events (
      id,
      occurred_at,
      organization_id,
      workspace_id,
      actor_user_id,
      actor_principal_type,
      represented_user_id,
      origin,
      client_id,
      grant_id,
      action,
      resource_type,
      resource_id,
      result,
      request_id,
      metadata
    ) values (
      ${id}::uuid,
      now(),
      ${orgIdSql},
      ${wsIdSql},
      ${actorIdSql},
      ${actorPrincipalType},
      null,
      ${origin},
      null,
      ${grantIdSql},
      ${params.action},
      ${params.resourceType},
      ${resourceIdSql},
      ${params.result},
      ${requestIdSql},
      ${metadataJson}::jsonb
    )
  `;

  return { id };
}

/**
 * Records an authorization denial event in a standalone short transaction.
 *
 * Called when server guards reject a critical operation (credentials.manage,
 * api_keys.revoke_any, workspace.members.manage). Since the primary transaction
 * is aborted/rolled back, recording in a short dedicated transaction ensures
 * the security incident is immutably preserved in the audit log (§20).
 */
export async function recordAuditDenied(
  ctx: RequestContext,
  params: {
    action: string;
    resourceType: string;
    resourceId?: string | null;
    origin?: AuditOrigin;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await withContext(prisma, ctx, async (auditTx) => {
      await recordAudit(auditTx, ctx, {
        ...params,
        result: "denied",
      });
    });
  } catch (err) {
    // Non-fatal for the denial response: log warning and let PermissionDeniedError bubble up
    console.error("Failed to persist audit denial event in short transaction:", err);
  }
}
