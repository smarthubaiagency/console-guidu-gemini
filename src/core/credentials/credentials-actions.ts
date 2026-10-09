"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";
import {
  registerCredential,
  revokeCredential,
  type AIProvider,
  type CredentialPurpose,
} from "./vault";
import { validateProviderKeyFormat } from "./providers";

export type CredentialActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
};

const RegisterInput = z.object({
  workspaceSlug: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "gemini"]),
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
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para o registro da credencial.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  const { workspaceSlug, provider, label, secret, purpose } = parsed.data;

  // Validate format
  const formatCheck = validateProviderKeyFormat(provider as AIProvider, secret);
  if (!formatCheck.valid) {
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: formatCheck.error ?? "Formato de chave inválido.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    await withContext(prisma, context, async (tx) => {
      return registerCredential(tx, context, {
        provider: provider as AIProvider,
        label,
        secret,
        purpose: purpose as CredentialPurpose,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/settings/credentials`);

    return {
      success: true,
      message: `Credencial '${label}' registrada com sucesso e protegida no cofre.`,
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
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
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Identificador de credencial inválido.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  const { workspaceSlug, credentialId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

    await withContext(prisma, context, async (tx) => {
      return revokeCredential(tx, context, credentialId);
    });

    revalidatePath(`/app/${workspaceSlug}/settings/credentials`);

    return {
      success: true,
      message: "Credencial revogada com sucesso.",
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }
}
