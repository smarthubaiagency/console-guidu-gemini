"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { getRequestBrand } from "@/core/brand/resolve";
import { actionFailure } from "@/core/i18n/errors";
import { notify } from "@/core/notifications/notify";
import { withSender } from "@/core/notifications/sender";
import { getNotificationTransport } from "@/core/notifications/transport";
import { EmailSendError } from "@/core/notifications/types";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import { getRequestOrigin } from "@/core/partners/resolve";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  isPartnerRole,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import { appConfig } from "@/core/config/app";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

/**
 * Test e-mail of Configurações › E-mail (CF3a): sent at once to the person
 * who asks, with the brand of the host and the sender of the level, so the
 * manager sees exactly what customers receive.
 */

type State = PartnerActionState;

async function sendTest(
  email: string | undefined,
  userId: string,
  senderPartnerId: string | null,
  path: string,
): Promise<State> {
  const t = await getTranslations("email");
  if (!email) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Sua conta não tem e-mail.",
      messageKey: "email.errors.noAddress",
    });
  }
  const brand = await getRequestBrand();
  const origin = (await getRequestOrigin()) ?? appConfig.url;
  const result = await notify(
    {
      type: "email.test",
      recipientEmail: email,
      idempotencyKey: `email-test:${userId}:${Date.now()}`,
      data: { settingsUrl: new URL(path, origin).toString() },
    },
    await withSender(prisma, senderPartnerId, {
      name: brand.name,
      supportEmail: brand.supportEmail,
      supportUrl: brand.supportUrl,
    }),
    getNotificationTransport(),
    { locale: await getLocale() },
  ).catch((err: unknown) => {
    if (err instanceof EmailSendError) {
      appLog.warn("email.test_failed", {
        status: err.status ?? "network",
        code: err.code,
      });
      throw new AppError({
        code: "conflict",
        safeMessage: "O provedor recusou o e-mail.",
        messageKey: "email.errors.provider",
      });
    }
    throw err;
  });
  if (result.status === "skipped") {
    throw new AppError({
      code: "conflict",
      safeMessage: "O envio de e-mail não está configurado.",
      messageKey: "email.errors.notConfigured",
    });
  }
  return { success: true, message: t("test.sent", { email }) };
}

export async function sendPlatformTestEmailAction(): Promise<State> {
  try {
    const identity = await requireMfa();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    if (
      admin?.status !== "active" ||
      !hasPlatformRolePermission(
        admin.role as PlatformAdminRoleKey,
        Permissions.PLATFORM_SETTINGS_MANAGE,
      )
    ) {
      throw new PermissionDeniedError();
    }
    return await sendTest(
      identity.email,
      identity.userId,
      null,
      "/platform/settings/email",
    );
  } catch (err) {
    return actionFailure(err);
  }
}

export async function sendPartnerTestEmailAction(): Promise<State> {
  try {
    const actor = await partnerActor();
    if (
      !actor.partnerRole ||
      !isPartnerRole(actor.partnerRole) ||
      !hasPartnerRolePermission(
        actor.partnerRole,
        Permissions.PARTNER_SETTINGS_MANAGE,
      )
    ) {
      throw new PermissionDeniedError();
    }
    const identity = await requireMfa();
    return await sendTest(
      identity.email,
      actor.userId,
      actor.partnerId,
      "/admin/settings/email",
    );
  } catch (err) {
    return actionFailure(err);
  }
}
