import crypto from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { recordAudit } from "@/core/audit/record";
import { InvalidApiKeyError } from "@/core/mcp/authenticate";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { type Assurance, requireMfa } from "@/core/privacy/export";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  platformAuditContext,
  type PlatformActor,
  withPlatformContext,
} from "./context";
import {
  type PlatformScope,
  PlatformScopeSchema,
  roleAllowsScope,
} from "./scopes";

/**
 * Administrative keys of the platform API and MCP (F4e, AC09).
 *
 * - Format `gdu_admin_<64 hex>`, stored only as SHA-256. The workspace
 *   lookup (`gdu_live_`, `public.api_keys`) never finds them, and this
 *   lookup never finds a workspace key.
 * - Created by an active internal role member with MFA verified, only with
 *   scopes the role allows; expiry is mandatory, up to 90 days.
 * - Every request checks the key again: status, expiry, the member's
 *   profile and internal role, and that the role still allows every scope
 *   of the key (otherwise the whole key is refused).
 */

export const PLATFORM_KEY_PREFIX = "gdu_admin_";
export const PLATFORM_KEY_MAX_DAYS = 90;
const LAST_USED_THROTTLE_MS = 60_000;

export type PlatformApiKeyItem = Readonly<{
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: "active" | "revoked" | "expired";
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
  mine: boolean;
}>;

export function hashPlatformKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export const CreatePlatformKeyInput = z
  .object({
    name: z.string().trim().min(1, "Informe um nome.").max(80),
    scopes: z
      .array(PlatformScopeSchema)
      .min(1, "Escolha ao menos um escopo.")
      .max(2),
    expiresInDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(PLATFORM_KEY_MAX_DAYS)
      .default(30),
  })
  .strict();

type CreateActor = Readonly<{
  userId: string;
  role: PlatformAdminRoleKey | null;
}>;

export async function createPlatformApiKey(
  tx: ContextTransaction,
  actor: CreateActor,
  input: unknown,
  assurance: Assurance,
): Promise<{ key: PlatformApiKeyItem; rawKey: string }> {
  if (!actor.role) throw new PermissionDeniedError();
  requireMfa(assurance);
  const parsed = CreatePlatformKeyInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage:
        parsed.error.issues[0]?.message ?? "Dados da chave inválidos.",
    });
  }
  const scopes = [...new Set(parsed.data.scopes)];
  if (!scopes.every((scope) => roleAllowsScope(actor.role, scope))) {
    throw new PermissionDeniedError(
      "Seu papel interno não permite um dos escopos escolhidos.",
    );
  }
  const entropy = crypto.randomBytes(32).toString("hex");
  const rawKey = `${PLATFORM_KEY_PREFIX}${entropy}`;
  const row = await tx.platformApiKey.create({
    data: {
      userId: actor.userId,
      name: parsed.data.name,
      prefix: `${PLATFORM_KEY_PREFIX}${entropy.slice(0, 6)}...`,
      keyHash: hashPlatformKey(rawKey),
      scopes,
      expiresAt: new Date(Date.now() + parsed.data.expiresInDays * 86_400_000),
    },
  });
  await recordAudit(
    tx,
    platformAuditContext({ userId: actor.userId, keyId: null }),
    {
      action: "platform_api_keys.create",
      resourceType: "platform_api_key",
      resourceId: row.id,
      result: "success",
      origin: "admin",
      metadata: { scopes, expiresAt: row.expiresAt.toISOString() },
    },
  );
  return { key: toItem(row, actor.userId), rawKey };
}

function toItem(
  row: Readonly<{
    id: string;
    userId: string;
    name: string;
    prefix: string;
    scopes: string[];
    status: string;
    expiresAt: Date;
    lastUsedAt: Date | null;
    createdAt: Date;
  }>,
  viewer: string,
): PlatformApiKeyItem {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    status:
      row.status === "revoked"
        ? "revoked"
        : row.expiresAt.getTime() <= Date.now()
          ? "expired"
          : "active",
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    mine: row.userId === viewer,
  };
}

/** Own keys; the platform owner sees every key (RLS decides). */
export async function listPlatformApiKeys(
  tx: ContextTransaction,
  actor: CreateActor,
): Promise<PlatformApiKeyItem[]> {
  if (!actor.role) throw new PermissionDeniedError();
  const rows = await tx.platformApiKey.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => toItem(row, actor.userId));
}

export async function revokePlatformApiKey(
  tx: ContextTransaction,
  actor: CreateActor,
  keyId: string,
): Promise<void> {
  if (!actor.role) throw new PermissionDeniedError();
  const id = z.string().uuid().safeParse(keyId);
  const changed = id.success
    ? await tx.platformApiKey.updateMany({
        where: { id: id.data, status: "active" },
        data: { status: "revoked", revokedAt: new Date() },
      })
    : { count: 0 };
  if (changed.count === 0) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Chave não encontrada ou já revogada.",
    });
  }
  await recordAudit(
    tx,
    platformAuditContext({ userId: actor.userId, keyId: null }),
    {
      action: "platform_api_keys.revoke",
      resourceType: "platform_api_key",
      resourceId: keyId,
      result: "success",
      origin: "admin",
    },
  );
}

type ResolvedRow = {
  id: string;
  user_id: string;
  scopes: string[];
  status: string;
  expires_at: Date;
};

/** Validates an administrative key; every failure answers the same 401. */
export async function authenticatePlatformApiKey(
  prisma: PrismaClient,
  rawKey: string,
  options: Readonly<{ requestId?: string; origin: "api" | "mcp" }>,
): Promise<PlatformActor & { scopes: PlatformScope[] }> {
  const invalid = () => new InvalidApiKeyError(options.requestId);
  if (
    typeof rawKey !== "string" ||
    !rawKey.startsWith(PLATFORM_KEY_PREFIX) ||
    !/^[0-9a-f]{64}$/.test(rawKey.slice(PLATFORM_KEY_PREFIX.length))
  ) {
    throw invalid();
  }
  let rows: ResolvedRow[];
  try {
    rows = await prisma.$queryRaw<ResolvedRow[]>`
      select id, user_id, scopes, status, expires_at
      from private.resolve_platform_api_key(${hashPlatformKey(rawKey)})
    `;
  } catch {
    throw invalid();
  }
  const row = rows[0];
  if (
    !row ||
    row.status !== "active" ||
    new Date(row.expires_at).getTime() <= Date.now()
  ) {
    throw invalid();
  }
  const scopes: PlatformScope[] = [];
  for (const scope of row.scopes) {
    const parsed = PlatformScopeSchema.safeParse(scope);
    if (!parsed.success) throw invalid();
    scopes.push(parsed.data);
  }
  const member = await getPlatformAdminMember(prisma, row.user_id);
  const role = member?.role as PlatformAdminRoleKey | undefined;
  if (!role || !scopes.every((scope) => roleAllowsScope(role, scope))) {
    throw invalid();
  }
  const actor: PlatformActor = { userId: row.user_id, role, keyId: row.id };

  await withPlatformContext(prisma, actor, async (tx) => {
    const profile = await tx.profile.findUnique({
      where: { id: actor.userId },
      select: { status: true },
    });
    if (profile?.status !== "active") throw invalid();
    const key = await tx.platformApiKey.findUnique({
      where: { id: row.id },
      select: { lastUsedAt: true },
    });
    const now = new Date();
    if (
      !key?.lastUsedAt ||
      now.getTime() - key.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS
    ) {
      await tx.platformApiKey.update({
        where: { id: row.id },
        data: { lastUsedAt: now },
      });
      await recordAudit(tx, platformAuditContext(actor), {
        action: "platform_api_keys.used",
        resourceType: "platform_api_key",
        resourceId: row.id,
        result: "success",
        origin: options.origin,
      });
    }
  });
  return { ...actor, scopes };
}
