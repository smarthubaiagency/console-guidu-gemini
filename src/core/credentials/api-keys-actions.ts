"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";
import { createApiKey, revokeApiKey } from "./api-keys";

export type ApiKeyActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  rawKey?: string;
  code?: AppErrorCode;
  requestId?: string;
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
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para emissão da chave de API.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  const { workspaceSlug, name, scopes: finalScopes, expiresInDays } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    const result = await withContext(prisma, context, async (tx) => {
      return createApiKey(tx, context, {
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
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
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
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Identificador de chave inválido.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  const { workspaceSlug, apiKeyId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    await withContext(prisma, context, async (tx) => {
      return revokeApiKey(tx, context, apiKeyId);
    });

    revalidatePath(`/app/${workspaceSlug}/settings/api`);

    return {
      success: true,
      message: "Chave de API revogada com sucesso.",
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }
}
