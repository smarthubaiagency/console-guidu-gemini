"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { partnerActor } from "@/core/partners/actors";
import { getRequestPartner } from "@/core/partners/resolve";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { updatePartnerAssistant } from "./assistant-config";
import {
  createCustomerReferral,
  deleteCustomerReferral,
  updateCustomerGuid,
  updateCustomerReferral,
} from "./customer-guids";
import {
  registerPartnerCredential,
  revokePartnerCredential,
  saveBackupSettings,
} from "./keys";
import { removeNoticeWebhook, saveNoticeWebhook } from "./notices/webhook";
import { saveAiProviders } from "./provider-settings";
import {
  ConfigValidationError,
  createTemplate,
  deleteTemplate,
  type TemplateActor,
  updateTemplate,
} from "./templates";

/**
 * Server actions of the AI screens of `/platform` (A3a: the house's agent
 * templates and the backup key) and of `/admin` (A3b: the partner's
 * Assistant, admin keys and templates; A3c: the customers' GUIDS and their
 * referrals). AAL2, the console's host, the
 * module flag and the role, checked here and again by the services and RLS.
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
const PARTNER_PROVIDERS_PATH = "/admin/ai/providers";
const PARTNER_TEMPLATES_PATH = "/admin/ai/templates";
const PARTNER_ASSISTANT_PATH = "/admin/ai/assistant";
const PARTNER_KEYS_PATH = "/admin/ai/keys";
const PARTNER_GUIDS_PATH = "/admin/ai/guids";

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

/** IA › Provedores e modelos of the platform (CF6a): one JSON document. */
export async function savePlatformAiProvidersAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await houseActor();
    await withIdentityContext(prisma, actor.userId, (tx) =>
      saveAiProviders(
        tx,
        {
          level: "platform",
          userId: actor.userId,
          platformRole: actor.platformRole ?? null,
        },
        parseJson(text(formData, "policy")),
      ),
    );
    revalidatePath("/", "layout");
    const t = await getTranslations("aiConsole");
    return { success: true, message: t("providersPage.saved") };
  } catch (err) {
    return failure(err);
  }
}

// ----------------------------------------------------------------------------
// Partner console (/admin, A3b)
// ----------------------------------------------------------------------------

async function partnerAiActor() {
  const actor = await partnerActor();
  if (!isModuleTechnicallyAvailable("ai-agents")) throw notFound();
  return actor;
}

function inPartner<T>(
  actor: Readonly<{ userId: string; partnerId: string }>,
  op: Parameters<typeof withIdentityContext<T>>[2],
): Promise<T> {
  return withIdentityContext(prisma, actor.userId, op, {
    partnerId: actor.partnerId,
  });
}

export async function savePartnerAssistantAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    const saved = await inPartner(actor, (tx) =>
      updatePartnerAssistant(tx, actor, {
        status: formData.get("active") === "on" ? "active" : "paused",
        config: parseJson(text(formData, "config")),
      }),
    );
    revalidatePath(PARTNER_ASSISTANT_PATH);
    const t = await getTranslations("aiConsole");
    return {
      success: true,
      message:
        saved.status === "active"
          ? t("assistant.savedActive")
          : t("assistant.saved"),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function registerPartnerKeyAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    await inPartner(actor, (tx) =>
      registerPartnerCredential(tx, actor, actor.partnerId, {
        provider: text(formData, "provider"),
        label: text(formData, "label"),
        secret: text(formData, "secret"),
        purpose: text(formData, "purpose") || "all",
      }),
    );
    revalidatePath(PARTNER_KEYS_PATH);
    const t = await getTranslations("aiConsole");
    return { success: true, message: t("keys.created") };
  } catch (err) {
    return failure(err);
  }
}

export async function revokePartnerKeyAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    await inPartner(actor, (tx) =>
      revokePartnerCredential(
        tx,
        actor,
        actor.partnerId,
        text(formData, "credentialId"),
      ),
    );
    revalidatePath(PARTNER_KEYS_PATH);
    const t = await getTranslations("aiConsole");
    return { success: true, message: t("keys.revoked") };
  } catch (err) {
    return failure(err);
  }
}

/** The partner's webhook for the hot-lead notices (A6a). */
export async function saveNoticeWebhookAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    await inPartner(actor, (tx) =>
      saveNoticeWebhook(tx, actor, actor.partnerId, {
        url: text(formData, "url"),
        secret: text(formData, "secret"),
        enabled: formData.get("enabled") === "on",
      }),
    );
    revalidatePath(PARTNER_ASSISTANT_PATH);
    const t = await getTranslations("aiConsole");
    return { success: true, message: t("noticeWebhook.saved") };
  } catch (err) {
    return failure(err);
  }
}

export async function removeNoticeWebhookAction(): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    await inPartner(actor, (tx) =>
      removeNoticeWebhook(tx, actor, actor.partnerId),
    );
    revalidatePath(PARTNER_ASSISTANT_PATH);
    const t = await getTranslations("aiConsole");
    return { success: true, message: t("noticeWebhook.removed") };
  } catch (err) {
    return failure(err);
  }
}

export async function createPartnerTemplateAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  let id: string;
  try {
    const actor = await partnerAiActor();
    const created = await inPartner(actor, (tx) =>
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
  revalidatePath(PARTNER_TEMPLATES_PATH);
  redirect(`${PARTNER_TEMPLATES_PATH}?edit=${id}`);
}

export async function savePartnerTemplateAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    const saved = await inPartner(actor, (tx) =>
      updateTemplate(tx, actor, text(formData, "templateId"), {
        name: text(formData, "name"),
        description: text(formData, "description"),
        segment: text(formData, "segment"),
        published: formData.get("published") === "on",
        config: parseJson(text(formData, "config")),
      }),
    );
    revalidatePath(PARTNER_TEMPLATES_PATH);
    const t = await getTranslations("aiConsole");
    return {
      success: true,
      message: t("templates.saved", { version: saved.version }),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function deletePartnerTemplateAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    await inPartner(actor, (tx) =>
      deleteTemplate(tx, actor, text(formData, "templateId")),
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(PARTNER_TEMPLATES_PATH);
  redirect(PARTNER_TEMPLATES_PATH);
}

export async function saveCustomerGuidAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    const saved = await inPartner(actor, (tx) =>
      updateCustomerGuid(tx, actor, text(formData, "agentId"), {
        status: formData.get("active") === "on" ? "active" : "paused",
        config: parseJson(text(formData, "config")),
      }),
    );
    revalidatePath(PARTNER_GUIDS_PATH);
    const t = await getTranslations("aiConsole");
    return {
      success: true,
      message:
        saved.status === "active" ? t("guids.savedActive") : t("guids.saved"),
    };
  } catch (err) {
    return failure(err);
  }
}

function referralInput(formData: FormData) {
  return {
    name: text(formData, "name"),
    referralTag: text(formData, "referralTag"),
    specialties: text(formData, "specialties")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    phone: text(formData, "phone"),
    city: text(formData, "city"),
    remote: formData.get("remote") === "on",
  };
}

export async function saveCustomerReferralAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    const agentId = text(formData, "agentId");
    const referralId = text(formData, "referralId");
    await inPartner(actor, (tx) =>
      referralId
        ? updateCustomerReferral(
            tx,
            actor,
            agentId,
            referralId,
            referralInput(formData),
          )
        : createCustomerReferral(tx, actor, agentId, referralInput(formData)),
    );
    revalidatePath(PARTNER_GUIDS_PATH);
    const t = await getTranslations("aiConsole");
    return {
      success: true,
      message: referralId
        ? t("guids.referrals.saved")
        : t("guids.referrals.created"),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteCustomerReferralAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    await inPartner(actor, (tx) =>
      deleteCustomerReferral(
        tx,
        actor,
        text(formData, "agentId"),
        text(formData, "referralId"),
      ),
    );
    revalidatePath(PARTNER_GUIDS_PATH);
    const t = await getTranslations("aiConsole");
    return { success: true, message: t("guids.referrals.deleted") };
  } catch (err) {
    return failure(err);
  }
}

/** The providers and models the partner offers its customers (CF6a). */
export async function savePartnerAiProvidersAction(
  _prev: AiConsoleActionState,
  formData: FormData,
): Promise<AiConsoleActionState> {
  try {
    const actor = await partnerAiActor();
    await inPartner(actor, (tx) =>
      saveAiProviders(
        tx,
        {
          level: "partner",
          userId: actor.userId,
          partnerId: actor.partnerId,
          partnerRole: actor.partnerRole,
        },
        parseJson(text(formData, "policy")),
      ),
    );
    revalidatePath(PARTNER_PROVIDERS_PATH);
    revalidatePath("/", "layout");
    const t = await getTranslations("aiConsole");
    return { success: true, message: t("providersPage.saved") };
  } catch (err) {
    return failure(err);
  }
}
