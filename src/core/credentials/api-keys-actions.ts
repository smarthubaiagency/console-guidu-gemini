"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { actionFailure } from "@/core/i18n/errors";
import { AppError, type AppErrorCode } from "@/shared/errors";
import { createApiKey, revokeApiKey } from "./api-keys";
import {
  WorkspaceScopeSchema,
  DEFAULT_WORKSPACE_SCOPES,
} from "@/core/mcp/scopes";

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
  scopes: z
    .array(WorkspaceScopeSchema)
    .min(1)
    .default([...DEFAULT_WORKSPACE_SCOPES]),
  expiresInDays: z.coerce.number().min(1).max(365).default(90),
});

export async function createApiKeyAction(
  _prev: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  const scopeRaw = formData.getAll("scopes");
  const scopes =
    scopeRaw.length > 0
      ? (scopeRaw as string[])
      : [...DEFAULT_WORKSPACE_SCOPES];

  const parsed = CreateKeyInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    name: formData.get("name"),
    scopes,
    expiresInDays: formData.get("expiresInDays") ?? 90,
  });

  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para emissão da chave de API.",
        messageKey: "mcp.errors.invalidCreate",
      }),
    );
  }

  const {
    workspaceSlug,
    name,
    scopes: finalScopes,
    expiresInDays,
  } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    const result = await withContext(prisma, context, async (tx) => {
      return createApiKey(tx, context, {
        name,
        scopes: finalScopes,
        expiresInDays,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/settings/mcp`);

    const t = await getTranslations("mcp");
    return {
      success: true,
      message: t("issued", { name }),
      rawKey: result.rawKey,
    };
  } catch (err: unknown) {
    return actionFailure(err);
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
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Identificador de chave inválido.",
        messageKey: "mcp.errors.invalidKeyId",
      }),
    );
  }

  const { workspaceSlug, apiKeyId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    await withContext(prisma, context, async (tx) => {
      return revokeApiKey(tx, context, apiKeyId);
    });

    revalidatePath(`/app/${workspaceSlug}/settings/mcp`);

    const t = await getTranslations("mcp");
    return {
      success: true,
      message: t("revoked"),
    };
  } catch (err: unknown) {
    return actionFailure(err);
  }
}
