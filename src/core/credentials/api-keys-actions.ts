"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { createApiKey, revokeApiKey } from "./api-keys";

export type ApiKeyActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  rawKey?: string;
};

const CreateKeyInput = z.object({
  workspaceSlug: z.string().min(1),
  name: z.string().min(1).max(64),
  scopes: z.array(z.string()).default(["read"]),
  expiresInDays: z.coerce.number().min(1).max(365).default(90),
});

export async function createApiKeyAction(
  _prev: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  const scopeRaw = formData.getAll("scopes");
  const scopes = scopeRaw.length > 0 ? (scopeRaw as string[]) : ["read"];

  const parsed = CreateKeyInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    name: formData.get("name"),
    scopes,
    expiresInDays: formData.get("expiresInDays") ?? 90,
  });

  if (!parsed.success) {
    return { error: "Dados inválidos para emissão da chave de API." };
  }

  const { workspaceSlug, name, scopes: finalScopes, expiresInDays } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    const result = await withContext(prisma, context, async (tx) => {
      return createApiKey(tx, {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        userId: identity.userId,
        name,
        scopes: finalScopes,
        expiresInDays,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/settings/api`);

    return {
      success: true,
      message: `Chave '${name}' emitida com sucesso. Guarde o segredo exibido abaixo.`,
      rawKey: result.rawKey,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro ao emitir chave de API.";
    return { error: msg };
  }
}

const RevokeKeyInput = z.object({
  workspaceSlug: z.string().min(1),
  apiKeyId: z.string().uuid(),
});

export async function revokeApiKeyAction(
  _prev: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  const parsed = RevokeKeyInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    apiKeyId: formData.get("apiKeyId"),
  });

  if (!parsed.success) {
    return { error: "Identificador de chave inválido." };
  }

  const { workspaceSlug, apiKeyId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    await withContext(prisma, context, async (tx) => {
      return revokeApiKey(tx, apiKeyId);
    });

    revalidatePath(`/app/${workspaceSlug}/settings/api`);

    return {
      success: true,
      message: "Chave de API revogada com sucesso.",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro ao revogar chave de API.";
    return { error: msg };
  }
}
