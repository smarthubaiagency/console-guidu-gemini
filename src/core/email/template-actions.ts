"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { partnerActor } from "@/core/partners/actors";
import { prisma } from "@/lib/prisma/client";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import {
  EmailTemplateInvalidError,
  restoreEmailTemplate,
  saveEmailTemplate,
  type EmailTemplateActor,
} from "./templates";

/**
 * Server actions of Configurações › E-mail › Modelos (CF3b), at the
 * platform and at the partner. The form sends `eventType`, `locale`,
 * `subject` and `body`; restore sends only the first two.
 */

export type EmailTemplateActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
  /** Message of the refused field, shown beside it. */
  fieldErrors?: Partial<Record<"subject" | "body", string>>;
};

const TARGET = z.object({
  eventType: z.string().min(1).max(80),
  locale: z.string().min(2).max(20),
});
const CONTENT = TARGET.extend({
  subject: z.string().max(1000),
  body: z.string().max(20_000),
});

const PLATFORM_PATH = "/platform/settings/email/templates";
const PARTNER_PATH = "/admin/settings/email/templates";

async function platformActor(): Promise<EmailTemplateActor> {
  const identity = await requireMfa();
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    level: "platform",
    userId: identity.userId,
    platformRole: admin?.status === "active" ? admin.role : null,
  };
}

async function partnerTemplateActor(): Promise<EmailTemplateActor> {
  const actor = await partnerActor();
  return { level: "partner", ...actor };
}

function inContext<T>(
  actor: EmailTemplateActor,
  operation: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  return withIdentityContext(prisma, actor.userId, operation, {
    partnerId: actor.level === "partner" ? actor.partnerId : null,
  });
}

async function failure(err: unknown): Promise<EmailTemplateActionState> {
  const result = await actionFailure(err);
  return err instanceof EmailTemplateInvalidError
    ? { ...result, fieldErrors: { [err.field]: result.error } }
    : result;
}

async function save(
  actor: () => Promise<EmailTemplateActor>,
  path: string,
  formData: FormData,
): Promise<EmailTemplateActionState> {
  try {
    const who = await actor();
    const input = CONTENT.parse(Object.fromEntries(formData));
    await inContext(who, (tx) => saveEmailTemplate(tx, who, input));
    revalidatePath(path);
    const t = await getTranslations("email.templates");
    return { success: true, message: t("saved") };
  } catch (err) {
    return failure(err);
  }
}

async function restore(
  actor: () => Promise<EmailTemplateActor>,
  path: string,
  formData: FormData,
): Promise<EmailTemplateActionState> {
  try {
    const who = await actor();
    const input = TARGET.parse(Object.fromEntries(formData));
    await inContext(who, (tx) => restoreEmailTemplate(tx, who, input));
    revalidatePath(path);
    const t = await getTranslations("email.templates");
    return { success: true, message: t("restored") };
  } catch (err) {
    return failure(err);
  }
}

export async function savePlatformEmailTemplateAction(
  _prev: EmailTemplateActionState,
  formData: FormData,
): Promise<EmailTemplateActionState> {
  return save(() => platformActor(), PLATFORM_PATH, formData);
}

export async function restorePlatformEmailTemplateAction(
  _prev: EmailTemplateActionState,
  formData: FormData,
): Promise<EmailTemplateActionState> {
  return restore(() => platformActor(), PLATFORM_PATH, formData);
}

export async function savePartnerEmailTemplateAction(
  _prev: EmailTemplateActionState,
  formData: FormData,
): Promise<EmailTemplateActionState> {
  return save(() => partnerTemplateActor(), PARTNER_PATH, formData);
}

export async function restorePartnerEmailTemplateAction(
  _prev: EmailTemplateActionState,
  formData: FormData,
): Promise<EmailTemplateActionState> {
  return restore(() => partnerTemplateActor(), PARTNER_PATH, formData);
}
