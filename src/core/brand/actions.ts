"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { getPartnerMembership } from "@/core/partners/members";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { actionFailure } from "@/core/i18n/errors";
import { AppError, type AppErrorCode } from "@/shared/errors";

import { BRAND_IMAGE_MAX_BYTES, type BrandImageKind } from "./logo";
import {
  saveBrandVersion,
  type BrandImageChanges,
  type BrandInput,
  type ImageChange,
} from "./service";

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

const IMAGE_FIELDS = {
  logo: ["logo", "removeLogo"],
  logoDark: ["logoDark", "removeLogoDark"],
  favicon: ["favicon", "removeFavicon"],
  shareImage: ["shareImage", "removeShareImage"],
} as const satisfies Record<BrandImageKind, readonly [string, string]>;

/** Too-large uploads are refused before their bytes are read. */
const TOO_LARGE: Record<BrandImageKind, readonly [string, string]> = {
  logo: ["O logo deve ter no máximo 256 KB.", "brand.errors.logoTooLarge"],
  logoDark: ["O logo deve ter no máximo 256 KB.", "brand.errors.logoTooLarge"],
  favicon: [
    "O favicon deve ter no máximo 64 KB.",
    "brand.errors.faviconTooLarge",
  ],
  shareImage: [
    "A imagem de compartilhamento deve ter no máximo 512 KB.",
    "brand.errors.shareImageTooLarge",
  ],
};

async function imageChangeFrom(
  formData: FormData,
  kind: BrandImageKind,
): Promise<ImageChange> {
  const [field, remove] = IMAGE_FIELDS[kind];
  if (formData.get(remove) === "on") return { kind: "remove" };
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return { kind: "keep" };
  if (file.size > BRAND_IMAGE_MAX_BYTES[kind]) {
    const [safeMessage, messageKey] = TOO_LARGE[kind];
    throw new AppError({ code: "invalid_input", safeMessage, messageKey });
  }
  return { kind: "replace", bytes: new Uint8Array(await file.arrayBuffer()) };
}

async function imageChangesFrom(
  formData: FormData,
): Promise<BrandImageChanges> {
  return {
    logoDark: await imageChangeFrom(formData, "logoDark"),
    favicon: await imageChangeFrom(formData, "favicon"),
    shareImage: await imageChangeFrom(formData, "shareImage"),
  };
}

function brandInputFrom(formData: FormData): BrandInput {
  return {
    displayName: text(formData, "displayName"),
    primaryColor: text(formData, "primaryColor"),
    supportEmail: text(formData, "supportEmail"),
    supportUrl: text(formData, "supportUrl"),
    tagline: text(formData, "tagline"),
    footerText: text(formData, "footerText"),
    whatsappNumber: text(formData, "whatsappNumber"),
    whatsappLabel: text(formData, "whatsappLabel"),
    whatsappMessage: text(formData, "whatsappMessage"),
  };
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
        messageKey: "brand.errors.notFound",
      });
    }
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    const logoChange = await imageChangeFrom(formData, "logo");
    const images = await imageChangesFrom(formData);

    const { version } = await withIdentityContext(
      prisma,
      identity.userId,
      (tx) =>
        saveBrandVersion(
          tx,
          {
            userId: identity.userId,
            platformRole: admin?.status === "active" ? admin.role : null,
          },
          partner.partnerId,
          brandInputFrom(formData),
          logoChange,
          images,
        ),
      { partnerId: partner.partnerId },
    );

    revalidatePath("/", "layout");
    const t = await getTranslations("brand");
    return { success: true, message: t("saved", { version }) };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Saves a new brand version of the host's partner from the partner console
 * (/admin): partner_owner and partner_admin only, revalidated here and by RLS.
 */
export async function savePartnerBrandAction(
  _prev: BrandActionState,
  formData: FormData,
): Promise<BrandActionState> {
  try {
    const identity = await requireMfa();
    const partner = await getRequestPartner();
    if (!partner) {
      throw new AppError({
        code: "not_found",
        safeMessage: "Recurso não encontrado.",
        messageKey: "brand.errors.notFound",
      });
    }
    const membership = await getPartnerMembership(
      prisma,
      identity.userId,
      partner.partnerId,
    );
    const logoChange = await imageChangeFrom(formData, "logo");
    const images = await imageChangesFrom(formData);

    const { version } = await withIdentityContext(
      prisma,
      identity.userId,
      (tx) =>
        saveBrandVersion(
          tx,
          { userId: identity.userId, partnerRole: membership?.role ?? null },
          partner.partnerId,
          brandInputFrom(formData),
          logoChange,
          images,
        ),
      { partnerId: partner.partnerId },
    );

    revalidatePath("/", "layout");
    const t = await getTranslations("brand");
    return { success: true, message: t("saved", { version }) };
  } catch (err) {
    return actionFailure(err);
  }
}
