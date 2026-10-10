"use server";

import { revalidatePath } from "next/cache";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";

import { MAX_LOGO_BYTES } from "./logo";
import { saveBrandVersion, type LogoChange } from "./service";

export type BrandActionState = {
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

async function logoChangeFrom(formData: FormData): Promise<LogoChange> {
  if (formData.get("removeLogo") === "on") return { kind: "remove" };
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { kind: "keep" };
  if (file.size > MAX_LOGO_BYTES) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "O logo deve ter no máximo 256 KB.",
    });
  }
  return { kind: "replace", bytes: new Uint8Array(await file.arrayBuffer()) };
}

/**
 * Saves a new version of the brand served on this platform host (house
 * partner). Requires AAL2 and platform owner/operations, revalidated here.
 */
export async function saveBrandAction(
  _prev: BrandActionState,
  formData: FormData,
): Promise<BrandActionState> {
  try {
    const identity = await requireMfa();
    const partner = await getRequestPartner();
    if (!partner?.isPlatformHost) {
      throw new AppError({
        code: "not_found",
        safeMessage: "Recurso não encontrado.",
      });
    }
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    const logoChange = await logoChangeFrom(formData);

    const { version } = await withIdentityContext(
      prisma,
      identity.userId,
      (tx) =>
        saveBrandVersion(
          tx,
          {
            userId: identity.userId,
            role: admin?.status === "active" ? admin.role : null,
          },
          partner.partnerId,
          {
            displayName: text(formData, "displayName"),
            primaryColor: text(formData, "primaryColor"),
            supportEmail: text(formData, "supportEmail"),
            supportUrl: text(formData, "supportUrl"),
          },
          logoChange,
        ),
      { partnerId: partner.partnerId },
    );

    revalidatePath("/", "layout");
    return { success: true, message: `Marca salva (versão ${version}).` };
  } catch (err) {
    const safe = toSafeError(err);
    return {
      error: safe.safeMessage,
      code: safe.code,
      requestId: safe.requestId,
    };
  }
}
