import "server-only";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { decryptSecret, encryptSecret } from "@/core/credentials/crypto";
import { validateProviderKeyFormat } from "@/core/credentials/providers";
import type { AIProvider, CredentialPurpose } from "@/core/credentials/vault";
import {
  adminAuditContext,
  requirePlatformPermission,
} from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  type PartnerRoleKey,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

/**
 * The two keys of the engine that are not the workspace's (especificação
 * §9.1 and §9.2, A2a):
 * - the admin key, in the partner's vault, used by its Assistant;
 * - the platform backup key and its cheap model, used only to finish the
 *   open conversations of a GUIDS whose customer key failed.
 * The secret is encrypted with the cipher of the workspace vault and never
 * leaves the server: DTOs carry the mask only. RLS repeats every check.
 * Partner functions run inside withIdentityContext with that partner's id;
 * platform functions inside withIdentityContext of the platform admin.
 */

export const AI_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
] as const satisfies readonly AIProvider[];

const ProviderSchema = z.enum(AI_PROVIDER_IDS);

function invalidKey(message: string): AppError {
  return new AppError({ code: "invalid_input", safeMessage: message });
}

/** Validates the provider and the key, and encrypts it. */
function sealKey(
  provider: AIProvider,
  secret: string,
): { encryptedPayload: string; maskedValue: string } {
  const format = validateProviderKeyFormat(provider, secret);
  if (!format.valid) {
    throw invalidKey(format.error ?? "Chave inválida.");
  }
  return encryptSecret(secret.trim());
}

// ----------------------------------------------------------------------------
// Partner vault (admin key)
// ----------------------------------------------------------------------------

export type PartnerKeyActor = Readonly<{
  userId: string;
  partnerRole: PartnerRoleKey | null;
}>;

export type PartnerCredentialDto = Readonly<{
  id: string;
  provider: AIProvider;
  purpose: CredentialPurpose;
  label: string;
  maskedValue: string;
  status: "active" | "revoked";
  createdAt: string;
}>;

export const PartnerCredentialInput = z.strictObject({
  provider: ProviderSchema,
  label: z.string().trim().min(1).max(120),
  secret: z.string().trim().min(1).max(500),
  purpose: z.enum(["chat", "embeddings", "all"]).default("all"),
});

function requirePartnerKeys(actor: PartnerKeyActor): void {
  if (
    !actor.partnerRole ||
    !hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_AI_AGENTS_MANAGE,
    )
  ) {
    throw new PermissionDeniedError();
  }
}

function toPartnerDto(row: {
  id: string;
  provider: string;
  purpose: string;
  label: string;
  maskedValue: string;
  status: string;
  createdAt: Date;
}): PartnerCredentialDto {
  return {
    id: row.id,
    provider: row.provider as AIProvider,
    purpose: row.purpose as CredentialPurpose,
    label: row.label,
    maskedValue: row.maskedValue,
    status: row.status as "active" | "revoked",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPartnerCredentials(
  tx: ContextTransaction,
  actor: PartnerKeyActor,
  partnerId: string,
): Promise<PartnerCredentialDto[]> {
  requirePartnerKeys(actor);
  const rows = await tx.partnerCredential.findMany({
    where: { partnerId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows.map(toPartnerDto);
}

export async function registerPartnerCredential(
  tx: ContextTransaction,
  actor: PartnerKeyActor,
  partnerId: string,
  input: unknown,
): Promise<PartnerCredentialDto> {
  requirePartnerKeys(actor);
  const parsed = PartnerCredentialInput.safeParse(input);
  if (!parsed.success) throw invalidKey("Dados da chave inválidos.");
  const { provider, label, secret, purpose } = parsed.data;
  const { encryptedPayload, maskedValue } = sealKey(provider, secret);

  const row = await tx.partnerCredential.create({
    data: {
      partnerId,
      provider,
      purpose,
      label,
      maskedValue,
      encryptedPayload,
      createdBy: actor.userId,
    },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.ai_credentials.create",
    resourceType: "partner_credential",
    resourceId: row.id,
    result: "success",
    origin: "admin",
    metadata: { partnerId, provider, purpose, maskedValue },
  });
  return toPartnerDto(row);
}

export async function revokePartnerCredential(
  tx: ContextTransaction,
  actor: PartnerKeyActor,
  partnerId: string,
  credentialId: string,
): Promise<PartnerCredentialDto> {
  requirePartnerKeys(actor);
  const found = await tx.partnerCredential.findFirst({
    where: { id: credentialId, partnerId, status: "active" },
  });
  if (!found) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Credencial não encontrada.",
      messageKey: "apiErrors.notFound",
    });
  }
  const row = await tx.partnerCredential.update({
    where: { id: found.id },
    data: { status: "revoked" },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.ai_credentials.revoke",
    resourceType: "partner_credential",
    resourceId: row.id,
    result: "success",
    origin: "admin",
    metadata: {
      partnerId,
      provider: row.provider,
      maskedValue: row.maskedValue,
    },
  });
  return toPartnerDto(row);
}

// ----------------------------------------------------------------------------
// Platform backup key
// ----------------------------------------------------------------------------

export type BackupSettingsDto = Readonly<{
  provider: AIProvider | null;
  maskedValue: string | null;
  model: string | null;
  updatedAt: string | null;
}>;

/**
 * The backup model, and a new key when one is given; `secret` absent keeps
 * the saved key, `clearKey` removes it (the backup stops).
 */
export const BackupSettingsInput = z
  .strictObject({
    provider: ProviderSchema.optional(),
    secret: z.string().trim().min(1).max(500).optional(),
    model: z.string().trim().min(1).max(200).nullable(),
    clearKey: z.boolean().default(false),
  })
  .refine((input) => !(input.clearKey && input.secret), {
    error: "Remova a chave ou informe uma nova, não os dois.",
  })
  .refine((input) => !input.secret || input.provider, {
    error: "Informe o provedor da chave.",
  });

export async function getBackupSettings(
  tx: ContextTransaction,
  role: PlatformAdminRoleKey | null,
): Promise<BackupSettingsDto> {
  requirePlatformPermission(role, Permissions.PLATFORM_AI_MANAGE);
  const row = await tx.platformAiSettings.findUnique({ where: { id: true } });
  return {
    provider: (row?.backupProvider as AIProvider | null | undefined) ?? null,
    maskedValue: row?.backupMaskedValue ?? null,
    model: row?.backupModel ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function saveBackupSettings(
  tx: ContextTransaction,
  userId: string,
  role: PlatformAdminRoleKey | null,
  input: unknown,
): Promise<BackupSettingsDto> {
  requirePlatformPermission(role, Permissions.PLATFORM_AI_MANAGE);
  const parsed = BackupSettingsInput.safeParse(input);
  if (!parsed.success) {
    throw invalidKey(
      parsed.error.issues[0]?.message ?? "Dados do backup inválidos.",
    );
  }
  const { provider, secret, model, clearKey } = parsed.data;

  const key =
    secret && provider
      ? (() => {
          const sealed = sealKey(provider, secret);
          return {
            backupProvider: provider,
            backupEncryptedPayload: sealed.encryptedPayload,
            backupMaskedValue: sealed.maskedValue,
          };
        })()
      : clearKey
        ? {
            backupProvider: null,
            backupEncryptedPayload: null,
            backupMaskedValue: null,
          }
        : {};

  const row = await tx.platformAiSettings.upsert({
    where: { id: true },
    create: { id: true, backupModel: model, updatedBy: userId, ...key },
    update: { backupModel: model, updatedBy: userId, ...key },
  });
  await recordAudit(tx, adminAuditContext(userId), {
    action: "platform.ai_backup.update",
    resourceType: "platform_ai_settings",
    resourceId: "backup",
    result: "success",
    origin: "admin",
    metadata: {
      provider: row.backupProvider ?? "",
      maskedValue: row.backupMaskedValue ?? "",
      model: row.backupModel ?? "",
      keyChanged: Boolean(secret) || clearKey,
    },
  });
  return {
    provider: (row.backupProvider as AIProvider | null) ?? null,
    maskedValue: row.backupMaskedValue,
    model: row.backupModel,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Resolution (server only, called by the engine from A2b on)
// ----------------------------------------------------------------------------

export type ResolvedKey = Readonly<{
  provider: AIProvider;
  secret: string;
}>;

/**
 * The newest active admin key of the partner for a provider. Internal: the
 * caller already authorized the turn; RLS still limits what it reads.
 */
export async function resolvePartnerKey(
  tx: ContextTransaction,
  partnerId: string,
  provider: AIProvider,
  purpose: CredentialPurpose = "chat",
): Promise<ResolvedKey | null> {
  const row = await tx.partnerCredential.findFirst({
    where: {
      partnerId,
      provider,
      status: "active",
      purpose: { in: [purpose, "all"] },
    },
    orderBy: { createdAt: "desc" },
  });
  return row ? { provider, secret: decryptSecret(row.encryptedPayload) } : null;
}

/** The platform backup key with its model, when one is configured. */
export async function resolveBackupKey(
  tx: ContextTransaction,
): Promise<(ResolvedKey & Readonly<{ model: string }>) | null> {
  const row = await tx.platformAiSettings.findUnique({ where: { id: true } });
  if (!row?.backupProvider || !row.backupEncryptedPayload || !row.backupModel) {
    return null;
  }
  return {
    provider: row.backupProvider as AIProvider,
    secret: decryptSecret(row.backupEncryptedPayload),
    model: row.backupModel,
  };
}
