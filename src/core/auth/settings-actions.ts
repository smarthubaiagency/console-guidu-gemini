"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import { saveSettings } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { loginMethodInput } from "./login-method-input";

/**
 * Server actions of Configurações › Autenticação (CF5b): the platform offers
 * Google or the link by e-mail, the partner may hide them on its hosts.
 * Saving goes through the settings cascade, which audits each change
 * (`platform.settings.save`, `partner.settings.save`).
 */

type State = PartnerActionState;

function unknownMethod(): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: "Configuração desconhecida neste nível.",
    messageKey: "settings.errors.unknown",
  });
}

async function saved(): Promise<State> {
  const t = await getTranslations("authSettings");
  return { success: true, message: t("messages.saved") };
}

export async function savePlatformLoginMethodAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireMfa();
    const input = loginMethodInput("platform", formData);
    if (!input) throw unknownMethod();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    await withIdentityContext(prisma, identity.userId, (tx) =>
      saveSettings(
        tx,
        {
          level: "platform",
          userId: identity.userId,
          platformRole: admin?.status === "active" ? admin.role : null,
        },
        input,
      ),
    );
    revalidatePath("/", "layout");
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePartnerLoginMethodAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const input = loginMethodInput("partner", formData);
    if (!input) throw unknownMethod();
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        saveSettings(
          tx,
          {
            level: "partner",
            userId: actor.userId,
            partnerId: actor.partnerId,
            partnerRole: actor.partnerRole,
          },
          input,
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/", "layout");
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}
