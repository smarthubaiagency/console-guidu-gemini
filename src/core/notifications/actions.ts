"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { markAllNoticesRead, markNoticeRead, saveMyPreference } from "./inbox";

/**
 * Server actions of the bell and of Minha conta › Notificações (CF3c). Each
 * one acts for the signed-in person only: the database (RLS) limits every
 * query to `app.user_id`. The screens refresh themselves after the answer.
 */

type State = PartnerActionState;

const id = z.string().uuid();

export async function markNoticeReadAction(noticeId: string): Promise<State> {
  try {
    const identity = await requireUser();
    const parsed = id.safeParse(noticeId);
    const found =
      parsed.success &&
      (await withIdentityContext(prisma, identity.userId, (tx) =>
        markNoticeRead(tx, identity.userId, parsed.data),
      ));
    if (!found) {
      throw new AppError({
        code: "not_found",
        safeMessage: "Aviso não encontrado.",
        messageKey: "notificationCenter.errors.notFound",
      });
    }
    const t = await getTranslations("notificationCenter.bell");
    return { success: true, message: t("marked") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function markAllNoticesReadAction(): Promise<State> {
  try {
    const identity = await requireUser();
    const count = await withIdentityContext(prisma, identity.userId, (tx) =>
      markAllNoticesRead(tx, identity.userId),
    );
    const t = await getTranslations("notificationCenter.bell");
    return {
      success: true,
      message: count > 0 ? t("markedAll") : t("nothingToMark"),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

const preference = z.object({
  eventType: z.string().min(1).max(80),
  channel: z.string().min(1).max(16),
  enabled: z.boolean(),
});

export async function saveNotificationPreferenceAction(
  input: Readonly<{ eventType: string; channel: string; enabled: boolean }>,
): Promise<State> {
  try {
    const identity = await requireUser();
    const parsed = preference.parse(input);
    await withIdentityContext(prisma, identity.userId, (tx) =>
      saveMyPreference(tx, identity.userId, parsed),
    );
    const t = await getTranslations("notificationCenter.preferences");
    return { success: true, message: t("saved") };
  } catch (err) {
    return actionFailure(err);
  }
}
