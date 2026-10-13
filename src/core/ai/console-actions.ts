"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { getRequestPartner } from "@/core/partners/resolve";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { saveBackupSettings } from "./keys";
import {
  ConfigValidationError,
  createTemplate,
  deleteTemplate,
  type TemplateActor,
  updateTemplate,
} from "./templates";

/**
 * Server actions of the AI screens of `/platform` (A3a): the house's agent
 * templates and the backup key. AAL2, the platform host, the module flag
 * and `platform.ai.manage`, checked here and again by the services and RLS.
 */

export type AiConsoleActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
  /** Message of each invalid field, by `tab.field` or form field name. */
  fieldErrors?: Record<string, string>;
};

const TEMPLATES_PATH = "/platform/ai/templates";
const BACKUP_PATH = "/platform/ai/backup";

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
    messageKey: "apiErrors.notFound",
  });
}

async function houseActor(): Promise<TemplateActor & { userId: string }> {
  const identity = await requireMfa();
  const partner = await getRequestPartner();
  if (!partner?.isPlatformHost || !isModuleTechnicallyAvailable("ai-agents")) {
    throw notFound();
  }
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    userId: identity.userId,
    partnerId: null,
    platformRole:
      admin?.status === "active" ? (admin.role as PlatformAdminRoleKey) : null,
  };
}

async function failure(err: unknown): Promise<AiConsoleActionState> {
  const { error, requestId } = await actionFailure(err);
  return {
    error,
    requestId,
    ...(err instanceof ConfigValidationError
      ? { fieldErrors: err.fieldErrors }
      : {}),
  };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ConfigValidationError({ config: "Configuração ilegível." });
  }
}

export async function createHouseTemplateAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  let id: string;
  try {
    const actor = await houseActor();
    const created = await withIdentityContext(prisma, actor.userId, (tx) =>
      createTemplate(tx, actor, {
        name: text(formData, "name"),
        description: text(formData, "description"),
        segment: text(formData, "segment"),
      }),
    );
    id = created.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(TEMPLATES_PATH);
  redirect(`${TEMPLATES_PATH}?edit=${id}`);
}

export async function saveHouseTemplateAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await houseActor();
    const saved = await withIdentityContext(prisma, actor.userId, (tx) =>
      updateTemplate(tx, actor, text(formData, "templateId"), {
        name: text(formData, "name"),
        description: text(formData, "description"),
        segment: text(formData, "segment"),
        published: formData.get("published") === "on",
        config: parseJson(text(formData, "config")),
      }),
    );
    revalidatePath(TEMPLATES_PATH);
    const t = await getTranslations("aiConsole");
    return {
      success: true,
      message: t("templates.saved", { version: saved.version }),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteHouseTemplateAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await houseActor();
    await withIdentityContext(prisma, actor.userId, (tx) =>
      deleteTemplate(tx, actor, text(formData, "templateId")),
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(TEMPLATES_PATH);
  redirect(TEMPLATES_PATH);
}

export async function saveBackupAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await houseActor();
    const secret = text(formData, "secret").trim();
    const provider = text(formData, "provider");
    const model = text(formData, "model").trim();
    await withIdentityContext(prisma, actor.userId, (tx) =>
      saveBackupSettings(tx, actor.userId, actor.platformRole ?? null, {
        ...(provider ? { provider } : {}),
        ...(secret ? { secret } : {}),
        model: model || null,
        clearKey: formData.get("clearKey") === "on",
      }),
    );
    revalidatePath(BACKUP_PATH);
    const t = await getTranslations("aiConsole");
    return { success: true, message: t("backup.saved") };
  } catch (err) {
    return failure(err);
  }
}
