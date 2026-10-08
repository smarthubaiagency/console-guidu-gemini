/**
 * ============================================================================
 * File: src/core/credentials/vault.ts
 * Module: BYOK Credential Vault Domain Service
 *
 * Maintenance Rationale:
 * - Implements Spec Section 16: "Cada workspace pode ter várias conexões...
 *   Guardar chaves em cofre com privilégios restritos. Metadados contêm identificação
 *   mascarada, estado e última verificação. Consultas posteriores não devolvem o segredo."
 * - All mutations and reads operate within `withContext` (ADR 0001).
 * - Decryption occurs only at the server boundary immediately before provider execution.
 * ============================================================================
 */

import type { ContextTransaction } from "@/lib/prisma/with-context";
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
 * Encrypts the raw secret at rest and returns only safe metadata.
 */
export async function registerCredential(
  tx: ContextTransaction,
  params: {
    organizationId: string;
    workspaceId: string;
    provider: AIProvider;
    label: string;
    secret: string;
    purpose?: CredentialPurpose;
  },
): Promise<CredentialItem> {
  const {
    organizationId,
    workspaceId,
    provider,
    label,
    secret,
    purpose = "all",
  } = params;

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
      organizationId,
      workspaceId,
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
 * Lists all credentials for a workspace (returning masked values, never raw secrets).
 */
export async function listWorkspaceCredentials(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<CredentialItem[]> {
  const records = await tx.credential.findMany({
    where: { workspaceId },
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
 * Revokes an existing credential.
 */
export async function revokeCredential(
  tx: ContextTransaction,
  credentialId: string,
): Promise<CredentialItem> {
  const updated = await tx.credential.update({
    where: { id: credentialId },
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
 * Used exclusively on the server when executing AI tasks.
 */
export async function resolveProviderSecret(
  tx: ContextTransaction,
  workspaceId: string,
  provider: AIProvider,
  purpose: CredentialPurpose = "all",
): Promise<string> {
  const candidate = await tx.credential.findFirst({
    where: {
      workspaceId,
      provider,
      status: "active",
      purpose: { in: [purpose, "all"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!candidate) {
    throw new CredentialNotFoundError(provider, workspaceId);
  }

  return decryptSecret(candidate.encryptedPayload);
}
