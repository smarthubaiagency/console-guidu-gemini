"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { safeInternalPath } from "@/core/auth/redirects";
import { getPartnerMembership } from "@/core/partners/members";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { actionFailure } from "@/core/i18n/errors";
import { AppError, type AppErrorCode } from "@/shared/errors";

import {
  acceptPendingLegalDocuments,
  deleteLegalTranslation,
  type LegalPublisher,
  publishLegalDocument,
  saveLegalTranslation,
} from "./service";
import { requestLegalTranslation } from "./machine";

export type LegalActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

const failure = (err: unknown): Promise<LegalActionState> => actionFailure(err);

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
    messageKey: "legal.errors.notFound",
  });
}

async function published(version: number): Promise<LegalActionState> {
  const t = await getTranslations("legal");
  return { success: true, message: t("published", { version }) };
}

function publishInput(formData: FormData) {
  return {
    kind: text(formData, "kind"),
    title: text(formData, "title"),
    body: text(formData, "body"),
    requiresAcceptance: formData.get("requiresAcceptance") === "on",
    ...(text(formData, "locale") ? { locale: text(formData, "locale") } : {}),
  };
}

/** Publishes terms or privacy of the house partner (platform console). */
export async function publishPlatformLegalAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  try {
    const identity = await requireMfa();
    const partner = await getRequestPartner();
    if (!partner?.isPlatformHost) throw notFound();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    const { version } = await withIdentityContext(
      prisma,
      identity.userId,
      (tx) =>
        publishLegalDocument(
          tx,
          {
            userId: identity.userId,
            platformRole: admin?.status === "active" ? admin.role : null,
          },
          partner.partnerId,
          publishInput(formData),
        ),
      { partnerId: partner.partnerId },
    );
    revalidatePath("/platform/legal");
    return await published(version);
  } catch (err) {
    return failure(err);
  }
}

/** Publishes terms or privacy of the host's partner (partner console). */
export async function publishPartnerLegalAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  try {
    const identity = await requireMfa();
    const partner = await getRequestPartner();
    if (!partner) throw notFound();
    const membership = await getPartnerMembership(
      prisma,
      identity.userId,
      partner.partnerId,
    );
    const { version } = await withIdentityContext(
      prisma,
      identity.userId,
      (tx) =>
        publishLegalDocument(
          tx,
          { userId: identity.userId, partnerRole: membership?.role ?? null },
          partner.partnerId,
          publishInput(formData),
        ),
      { partnerId: partner.partnerId },
    );
    revalidatePath("/admin/legal");
    return await published(version);
  } catch (err) {
    return failure(err);
  }
}

/**
 * Accepts every document still pending on this host. What is accepted is
 * recomputed on the server, never taken from the form.
 */
export async function acceptLegalDocumentsAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  const next = safeInternalPath(text(formData, "next"));
  try {
    const identity = await requireUser();
    const partner = await getRequestPartner();
    if (!partner) throw notFound();
    if (formData.get("agree") !== "on") {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Marque a caixa para aceitar os documentos.",
        messageKey: "legal.errors.mustAgree",
      });
    }
    await withIdentityContext(
      prisma,
      identity.userId,
      (tx) =>
        acceptPendingLegalDocuments(tx, partner.partnerId, identity.userId),
      { partnerId: partner.partnerId },
    );
  } catch (err) {
    return failure(err);
  }
  redirect(next);
}

type LegalScope = "platform" | "partner";

/**
 * Runs `fn` as the publisher of the request host's partner: the house
 * partner from the platform console, the host's partner from /admin.
 */
async function asPublisher<T>(
  scope: LegalScope,
  fn: (
    tx: ContextTransaction,
    actor: LegalPublisher,
    partnerId: string,
  ) => Promise<T>,
): Promise<T> {
  const identity = await requireMfa();
  const partner = await getRequestPartner();
  if (!partner || (scope === "platform" && !partner.isPlatformHost)) {
    throw notFound();
  }
  let actor: LegalPublisher;
  if (scope === "platform") {
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    actor = {
      userId: identity.userId,
      platformRole: admin?.status === "active" ? admin.role : null,
    };
  } else {
    const membership = await getPartnerMembership(
      prisma,
      identity.userId,
      partner.partnerId,
    );
    actor = { userId: identity.userId, partnerRole: membership?.role ?? null };
  }
  const result = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => fn(tx, actor, partner.partnerId),
    { partnerId: partner.partnerId },
  );
  revalidatePath(scope === "platform" ? "/platform/legal" : "/admin/legal");
  return result;
}

async function saveTranslation(
  scope: LegalScope,
  formData: FormData,
): Promise<LegalActionState> {
  try {
    const locale = text(formData, "locale");
    await asPublisher(scope, (tx, actor, partnerId) =>
      saveLegalTranslation(
        tx,
        actor,
        partnerId,
        text(formData, "documentId"),
        locale,
        { title: text(formData, "title"), body: text(formData, "body") },
      ),
    );
    const t = await getTranslations("legal");
    return { success: true, message: t("translations.saved", { locale }) };
  } catch (err) {
    return failure(err);
  }
}

async function removeTranslation(
  scope: LegalScope,
  formData: FormData,
): Promise<LegalActionState> {
  try {
    const locale = text(formData, "locale");
    await asPublisher(scope, (tx, actor, partnerId) =>
      deleteLegalTranslation(
        tx,
        actor,
        partnerId,
        text(formData, "documentId"),
        locale,
      ),
    );
    const t = await getTranslations("legal");
    return { success: true, message: t("translations.removed", { locale }) };
  } catch (err) {
    return failure(err);
  }
}

/** Saves the manual translation of a house partner version (platform). */
export async function savePlatformLegalTranslationAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  return saveTranslation("platform", formData);
}

/** Removes a translation of a house partner version (platform). */
export async function deletePlatformLegalTranslationAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  return removeTranslation("platform", formData);
}

/** Saves the manual translation of a version of the host's partner. */
export async function savePartnerLegalTranslationAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  return saveTranslation("partner", formData);
}

/** Removes a translation of a version of the host's partner. */
export async function deletePartnerLegalTranslationAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  return removeTranslation("partner", formData);
}

async function machineTranslation(
  scope: LegalScope,
  formData: FormData,
): Promise<LegalActionState> {
  try {
    await asPublisher(scope, (tx, actor, partnerId) =>
      requestLegalTranslation(
        tx,
        actor,
        partnerId,
        text(formData, "documentId"),
      ),
    );
    const t = await getTranslations("legal");
    return { success: true, message: t("machine.queued") };
  } catch (err) {
    return failure(err);
  }
}

/** Queues the machine translation of a house partner version (I6). */
export async function translatePlatformLegalAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  return machineTranslation("platform", formData);
}

/** Queues the machine translation of a version of the host's partner (I6). */
export async function translatePartnerLegalAction(
  _prev: LegalActionState,
  formData: FormData,
): Promise<LegalActionState> {
  return machineTranslation("partner", formData);
}
