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
import {
  registerCredential,
  revokeCredential,
  type AIProvider,
  type CredentialPurpose,
} from "./vault";
import { AI_PROVIDERS, validateProviderKeyFormat } from "./providers";

export type CredentialActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
};

/** Message key of a rejected key format, mirroring validateProviderKeyFormat. */
function keyFormatMessage(
  provider: AIProvider,
  secret: string,
): { messageKey: string; messageValues?: Record<string, string> } {
  const trimmed = secret.trim();
  if (trimmed.length < 15) {
    return { messageKey: "credentials.errors.keyTooShort" };
  }
  const meta = AI_PROVIDERS[provider];
  if (!meta) return { messageKey: "credentials.errors.unknownProvider" };
  if (meta.keyPrefix && !trimmed.startsWith(meta.keyPrefix)) {
    return {
      messageKey: "credentials.errors.keyWrongPrefix",
      messageValues: { provider: meta.name, prefix: meta.keyPrefix },
    };
  }
  return { messageKey: "credentials.errors.invalidKeyFormat" };
}

const RegisterInput = z.object({
  workspaceSlug: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "gemini", "openrouter"]),
  label: z.string().min(1).max(64),
  secret: z.string().min(10),
  purpose: z.enum(["all", "chat", "embeddings"]).default("all"),
});

export async function registerCredentialAction(
  _prev: CredentialActionState,
  formData: FormData,
): Promise<CredentialActionState> {
  const parsed = RegisterInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    provider: formData.get("provider"),
    label: formData.get("label"),
    secret: formData.get("secret"),
    purpose: formData.get("purpose") ?? "all",
  });

  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para o registro da credencial.",
        messageKey: "credentials.errors.invalidRegister",
      }),
    );
  }

  const { workspaceSlug, provider, label, secret, purpose } = parsed.data;

  // Validate format
  const formatCheck = validateProviderKeyFormat(provider as AIProvider, secret);
  if (!formatCheck.valid) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: formatCheck.error ?? "Formato de chave inválido.",
        ...keyFormatMessage(provider as AIProvider, secret),
      }),
    );
  }

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    await withContext(prisma, context, async (tx) => {
      return registerCredential(tx, context, {
        provider: provider as AIProvider,
        label,
        secret,
        purpose: purpose as CredentialPurpose,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/settings/credentials`);

    const t = await getTranslations("credentials");
    return {
      success: true,
      message: t("registered", { label }),
    };
  } catch (err: unknown) {
    return actionFailure(err);
  }
}

const RevokeInput = z.object({
  workspaceSlug: z.string().min(1),
  credentialId: z.string().uuid(),
});

export async function revokeCredentialAction(
  _prev: CredentialActionState,
  formData: FormData,
): Promise<CredentialActionState> {
  const parsed = RevokeInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    credentialId: formData.get("credentialId"),
  });

  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Identificador de credencial inválido.",
        messageKey: "credentials.errors.invalidCredentialId",
      }),
    );
  }

  const { workspaceSlug, credentialId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    await withContext(prisma, context, async (tx) => {
      return revokeCredential(tx, context, credentialId);
    });

    revalidatePath(`/app/${workspaceSlug}/settings/credentials`);

    const t = await getTranslations("credentials");
    return {
      success: true,
      message: t("revoked"),
    };
  } catch (err: unknown) {
    return actionFailure(err);
  }
}
