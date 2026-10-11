"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireUser } from "@/core/auth/identity";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { actionFailure } from "@/core/i18n/errors";
import { AppError } from "@/shared/errors";

import { withPlatformContext } from "./context";
import { createPlatformApiKey, revokePlatformApiKey } from "./keys";

/** Server actions of Plataforma › Chaves de API (F4e). */

export type PlatformKeyActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
  /** Shown once, right after creation. */
  rawKey?: string;
};

async function platformActor() {
  const partner = await getRequestPartner();
  if (!partner?.isPlatformHost) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Recurso não encontrado.",
      messageKey: "platformKeys.errors.notFound",
    });
  }
  const identity = await requireUser();
  const member = await getPlatformAdminMember(prisma, identity.userId);
  return {
    identity,
    actor: {
      userId: identity.userId,
      role: (member?.role ?? null) as PlatformAdminRoleKey | null,
    },
  };
}

async function failure(err: unknown): Promise<PlatformKeyActionState> {
  const { error, requestId } = await actionFailure(err);
  return { error, requestId };
}

export async function createPlatformKeyAction(
  _prev: PlatformKeyActionState,
  formData: FormData,
): Promise<PlatformKeyActionState> {
  try {
    const { identity, actor } = await platformActor();
    const { rawKey } = await withPlatformContext(
      prisma,
      { userId: actor.userId, keyId: null },
      (tx) =>
        createPlatformApiKey(
          tx,
          actor,
          {
            name: formData.get("name"),
            scopes: formData.getAll("scopes"),
            expiresInDays: formData.get("expiresInDays") ?? undefined,
          },
          { mfaVerified: identity.mfaSatisfied },
        ),
    );
    revalidatePath("/platform/api-keys");
    const t = await getTranslations("platformKeys");
    return {
      success: true,
      message: t("created"),
      rawKey,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function revokePlatformKeyAction(
  _prev: PlatformKeyActionState,
  formData: FormData,
): Promise<PlatformKeyActionState> {
  try {
    const { actor } = await platformActor();
    const keyId = z.string().uuid().parse(formData.get("keyId"));
    await withPlatformContext(
      prisma,
      { userId: actor.userId, keyId: null },
      (tx) => revokePlatformApiKey(tx, actor, keyId),
    );
    revalidatePath("/platform/api-keys");
    const t = await getTranslations("platformKeys");
    return { success: true, message: t("revoked") };
  } catch (err) {
    return failure(err);
  }
}
