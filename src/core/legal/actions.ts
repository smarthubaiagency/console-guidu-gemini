"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { safeInternalPath } from "@/core/auth/redirects";
import { getPartnerMembership } from "@/core/partners/members";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";

import { acceptPendingLegalDocuments, publishLegalDocument } from "./service";

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

function failure(err: unknown): LegalActionState {
  const safe = toSafeError(err);
  return {
    error: safe.safeMessage,
    code: safe.code,
    requestId: safe.requestId,
  };
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
  });
}

function publishInput(formData: FormData) {
  return {
    kind: text(formData, "kind"),
    title: text(formData, "title"),
    body: text(formData, "body"),
    requiresAcceptance: formData.get("requiresAcceptance") === "on",
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
    return { success: true, message: `Versão ${version} publicada.` };
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
    return { success: true, message: `Versão ${version} publicada.` };
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
