/**
 * ============================================================================
 * File: src/core/credentials/vault.ts
 * Module: BYOK Credential Vault Domain Service
 *
 * Maintenance Rationale:
 * - Implements Spec Section 16 & C07:
 *   - "Cada workspace pode ter várias conexões... Guardar chaves em cofre com privilégios restritos."
 *   - registerCredential e revokeCredential exigem credentials.manage.
 *   - listWorkspaceCredentials exige credentials.read.
 *   - resolveProviderSecret é interno: não exposto a action e recebe RequestContext já autorizado.
 *   - Funções recebem ctx: RequestContext e usam ctx.workspaceId/ctx.organizationId.
 * - All mutations and reads operate within `withContext` (ADR 0001).
 * - Decryption occurs only at the server boundary immediately before provider execution.
 * ============================================================================
 */

import "server-only";

import type { ContextTransaction, RequestContext } from "@/lib/prisma/with-context";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import { encryptSecret, decryptSecret } from "./crypto";

export type AIProvider = "openai" | "anthropic" | "gemini";
export type CredentialPurpose = "chat" | "embeddings" | "all";

export type CredentialItem = {
  id: string;
  organizationId: string;
  workspaceId: string;
  provider: AIProvider;
  purpose: CredentialPurpose;
  label: string;
  maskedValue: string;
  status: "active" | "revoked";
  createdAt: Date;
  updatedAt: Date;
};

export class CredentialNotFoundError extends Error {
  constructor(provider: string, workspaceId: string) {
    super(`Active credential for provider '${provider}' not found in workspace '${workspaceId}'`);
    this.name = "CredentialNotFoundError";
  }
}

export class InvalidProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported AI provider: ${provider}. Supported providers are: openai, anthropic, gemini.`);
    this.name = "InvalidProviderError";
  }
}

const SUPPORTED_PROVIDERS: Set<string> = new Set(["openai", "anthropic", "gemini"]);

/**
 * Registers a new BYOK credential inside the contextual workspace.
 * Requires `credentials.manage` permission.
 * Encrypts the raw secret at rest and returns only safe metadata.
 */
export async function registerCredential(
  tx: ContextTransaction,
  ctx: RequestContext,
  params: {
    provider: AIProvider;
    label: string;
    secret: string;
    purpose?: CredentialPurpose;
  },
): Promise<CredentialItem> {
  await requireWorkspacePermission(tx, ctx, Permissions.CREDENTIALS_MANAGE);

  const { provider, label, secret, purpose = "all" } = params;

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new InvalidProviderError(provider);
  }

  if (!label || label.trim().length === 0) {
    throw new Error("Label is required for credential registration");
  }

  if (!secret || secret.trim().length === 0) {
    throw new Error("Secret value cannot be empty");
  }

  const { encryptedPayload, maskedValue } = encryptSecret(secret.trim());

  const record = await tx.credential.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      provider,
      purpose,
      label: label.trim(),
      maskedValue,
      encryptedPayload,
      status: "active",
    },
  });

  return {
    id: record.id,
    organizationId: record.organizationId,
    workspaceId: record.workspaceId,
    provider: record.provider as AIProvider,
    purpose: record.purpose as CredentialPurpose,
    label: record.label,
    maskedValue: record.maskedValue,
    status: record.status as "active" | "revoked",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Lists all credentials for the contextual workspace.
 * Requires `credentials.read` permission.
 * Returns only masked values, never raw secrets.
 */
export async function listWorkspaceCredentials(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<CredentialItem[]> {
  await requireWorkspacePermission(tx, ctx, Permissions.CREDENTIALS_READ);

  const records = await tx.credential.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
  });

  return records.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    workspaceId: r.workspaceId,
    provider: r.provider as AIProvider,
    purpose: r.purpose as CredentialPurpose,
    label: r.label,
    maskedValue: r.maskedValue,
    status: r.status as "active" | "revoked",
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Revokes an existing credential in the contextual workspace.
 * Requires `credentials.manage` permission.
 */
export async function revokeCredential(
  tx: ContextTransaction,
  ctx: RequestContext,
  credentialId: string,
): Promise<CredentialItem> {
  await requireWorkspacePermission(tx, ctx, Permissions.CREDENTIALS_MANAGE);

  const candidate = await tx.credential.findFirst({
    where: { id: credentialId, workspaceId: ctx.workspaceId },
  });

  if (!candidate) {
    throw new Error("Credencial não encontrada.");
  }

  const updated = await tx.credential.update({
    where: { id: candidate.id },
    data: { status: "revoked" },
  });

  return {
    id: updated.id,
    organizationId: updated.organizationId,
    workspaceId: updated.workspaceId,
    provider: updated.provider as AIProvider,
    purpose: updated.purpose as CredentialPurpose,
    label: updated.label,
    maskedValue: updated.maskedValue,
    status: updated.status as "active" | "revoked",
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Resolves and decrypts the active raw secret for a provider in the workspace.
 * Internal: not exposed to any client actions; receives RequestContext already authorized.
 */
export async function resolveProviderSecret(
  tx: ContextTransaction,
  ctx: RequestContext,
  provider: AIProvider,
  purpose: CredentialPurpose = "all",
): Promise<string> {
  const candidate = await tx.credential.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      provider,
      status: "active",
      purpose: { in: [purpose, "all"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!candidate) {
    throw new CredentialNotFoundError(provider, ctx.workspaceId);
  }

  return decryptSecret(candidate.encryptedPayload);
}
