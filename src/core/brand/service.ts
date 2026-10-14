import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  type PartnerRoleKey,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  checkBrandImage,
  type BrandImageKind,
  type BrandImageMime,
} from "./logo";
import { normalizeHexColor } from "./tokens";

const emptyToNull = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.trim() === "")
    ? null
    : value;

export const BrandInputSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  primaryColor: z.preprocess(
    emptyToNull,
    z
      .string()
      .nullable()
      .transform((v, ctx) => {
        if (v === null) return null;
        const color = normalizeHexColor(v);
        if (!color) {
          ctx.addIssue({ code: "custom", message: "Use uma cor #rrggbb." });
          return z.NEVER;
        }
        return color;
      }),
  ),
  supportEmail: z.preprocess(
    emptyToNull,
    z.string().trim().max(254).email().nullable(),
  ),
  supportUrl: z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .max(2048)
      .url()
      .refine((v) => v.startsWith("https://"), "Use um endereço https://.")
      .nullable(),
  ),
  tagline: z.preprocess(emptyToNull, z.string().trim().max(120).nullable()),
  footerText: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
  // Digits only, with the country code; spaces, dashes and "+" are dropped.
  whatsappNumber: z.preprocess(
    (value) =>
      typeof value === "string"
        ? emptyToNull(value.replace(/[\s()+.-]/g, ""))
        : emptyToNull(value),
    z
      .string()
      .regex(/^[1-9]\d{7,14}$/, "Use o número com DDI e DDD.")
      .nullable(),
  ),
  whatsappLabel: z.preprocess(
    emptyToNull,
    z.string().trim().max(40).nullable(),
  ),
  whatsappMessage: z.preprocess(
    emptyToNull,
    z.string().trim().max(300).nullable(),
  ),
});

/** Raw form values; empty or missing optional fields mean "not set". */
export type BrandInput = Readonly<{
  displayName: string;
  primaryColor?: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
  tagline?: string | null;
  footerText?: string | null;
  whatsappNumber?: string | null;
  whatsappLabel?: string | null;
  whatsappMessage?: string | null;
}>;

/** keep: reuse the current logo; remove: no logo; bytes: new logo. */
export type LogoChange =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "replace"; bytes: Uint8Array };

/** Same as LogoChange, for the other images of the brand (CF2). */
export type ImageChange = LogoChange;

/** Changes of the dark logo, favicon and share image; missing means keep. */
export type BrandImageChanges = Partial<
  Record<Exclude<BrandImageKind, "logo">, ImageChange>
>;

type ImageError = "empty" | "too_large" | "unsupported_type" | "not_square";

const IMAGE_ERRORS: Readonly<
  Record<BrandImageKind, Partial<Record<ImageError, readonly [string, string]>>>
> = {
  logo: {
    empty: ["O arquivo do logo está vazio.", "brand.errors.logoEmpty"],
    too_large: [
      "O logo deve ter no máximo 256 KB.",
      "brand.errors.logoTooLarge",
    ],
    unsupported_type: [
      "Use um logo PNG, JPEG ou WebP.",
      "brand.errors.logoUnsupportedType",
    ],
  },
  logoDark: {
    empty: ["O arquivo do logo está vazio.", "brand.errors.logoEmpty"],
    too_large: [
      "O logo deve ter no máximo 256 KB.",
      "brand.errors.logoTooLarge",
    ],
    unsupported_type: [
      "Use um logo PNG, JPEG ou WebP.",
      "brand.errors.logoUnsupportedType",
    ],
  },
  favicon: {
    empty: ["O arquivo do favicon está vazio.", "brand.errors.faviconEmpty"],
    too_large: [
      "O favicon deve ter no máximo 64 KB.",
      "brand.errors.faviconTooLarge",
    ],
    unsupported_type: [
      "Use um favicon PNG ou ICO.",
      "brand.errors.faviconUnsupportedType",
    ],
    not_square: [
      "O favicon deve ser quadrado.",
      "brand.errors.faviconNotSquare",
    ],
  },
  shareImage: {
    empty: [
      "O arquivo da imagem de compartilhamento está vazio.",
      "brand.errors.shareImageEmpty",
    ],
    too_large: [
      "A imagem de compartilhamento deve ter no máximo 512 KB.",
      "brand.errors.shareImageTooLarge",
    ],
    unsupported_type: [
      "Use uma imagem de compartilhamento PNG, JPEG ou WebP.",
      "brand.errors.shareImageUnsupportedType",
    ],
  },
};

type StoredImage = { bytes: Uint8Array; mime: BrandImageMime | string };

/** The new image of a change; "keep" is resolved later from the current version. */
function checkedImage(
  kind: BrandImageKind,
  change: ImageChange,
): StoredImage | null {
  if (change.kind !== "replace") return null;
  const check = checkBrandImage(kind, change.bytes);
  if (!check.ok) {
    const [safeMessage, messageKey] = IMAGE_ERRORS[kind][check.reason] ?? [
      "Imagem inválida.",
      "brand.errors.invalidInput",
    ];
    throw new AppError({ code: "invalid_input", safeMessage, messageKey });
  }
  return { bytes: change.bytes, mime: check.mime };
}

/** Message keys of the schema's own messages; zod defaults keep their text. */
const ISSUE_KEYS: Readonly<Record<string, string>> = {
  "Use uma cor #rrggbb.": "brand.errors.invalidColor",
  "Use um endereço https://.": "brand.errors.httpsRequired",
  "Use o número com DDI e DDD.": "brand.errors.invalidWhatsapp",
};

/**
 * Who saves a brand: platform owner/operations (any context partner) or the
 * partner_owner/partner_admin of the context partner (P4a).
 */
export type BrandActor = Readonly<{
  userId: string;
  platformRole?: PlatformAdminRoleKey | null;
  partnerRole?: PartnerRoleKey | null;
}>;

export function canManageBrand(actor: BrandActor): boolean {
  return Boolean(
    (actor.platformRole &&
      hasPlatformRolePermission(
        actor.platformRole,
        Permissions.PLATFORM_BRAND_MANAGE,
      )) ||
    (actor.partnerRole &&
      hasPartnerRolePermission(
        actor.partnerRole,
        Permissions.PARTNER_BRAND_MANAGE,
      )),
  );
}

/**
 * Saves a new brand version for the context partner (insert-only history).
 * RLS repeats the role and partner checks.
 * Must run inside withIdentityContext with that partner's id.
 */
export async function saveBrandVersion(
  tx: ContextTransaction,
  actor: BrandActor,
  partnerId: string,
  input: BrandInput,
  logoChange: LogoChange,
  images: BrandImageChanges = {},
): Promise<{ version: number }> {
  if (!canManageBrand(actor)) throw new PermissionDeniedError();

  const parsed = BrandInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const messageKey = issue
      ? ISSUE_KEYS[issue.message]
      : "brand.errors.invalidInput";
    throw new AppError({
      code: "invalid_input",
      safeMessage: issue?.message ?? "Dados de marca inválidos.",
      ...(messageKey ? { messageKey } : {}),
    });
  }

  const changes: Record<BrandImageKind, ImageChange> = {
    logo: logoChange,
    logoDark: images.logoDark ?? { kind: "keep" },
    favicon: images.favicon ?? { kind: "keep" },
    shareImage: images.shareImage ?? { kind: "keep" },
  };
  const next: Record<BrandImageKind, StoredImage | null> = {
    logo: checkedImage("logo", changes.logo),
    logoDark: checkedImage("logoDark", changes.logoDark),
    favicon: checkedImage("favicon", changes.favicon),
    shareImage: checkedImage("shareImage", changes.shareImage),
  };
  if (
    !parsed.data.whatsappNumber &&
    (parsed.data.whatsappLabel || parsed.data.whatsappMessage)
  ) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Informe o número do WhatsApp.",
      messageKey: "brand.errors.whatsappRequired",
    });
  }

  // Serializes versions per partner; the unique key backs it.
  await tx.$executeRaw`
    select pg_advisory_xact_lock(hashtext('partner_brand:' || ${partnerId}::text))
  `;
  const current = await tx.partnerBrand.findFirst({
    where: { partnerId },
    orderBy: { version: "desc" },
    select: {
      version: true,
      logo: true,
      logoMime: true,
      logoDark: true,
      logoDarkMime: true,
      favicon: true,
      faviconMime: true,
      shareImage: true,
      shareImageMime: true,
    },
  });
  // Versions are insert-only: a kept image is copied to the new version.
  const kept = (
    bytes: Uint8Array | null | undefined,
    mime: string | null | undefined,
  ): StoredImage | null =>
    bytes && mime ? { bytes: new Uint8Array(bytes), mime } : null;
  if (changes.logo.kind === "keep") {
    next.logo = kept(current?.logo, current?.logoMime);
  }
  if (changes.logoDark.kind === "keep") {
    next.logoDark = kept(current?.logoDark, current?.logoDarkMime);
  }
  if (changes.favicon.kind === "keep") {
    next.favicon = kept(current?.favicon, current?.faviconMime);
  }
  if (changes.shareImage.kind === "keep") {
    next.shareImage = kept(current?.shareImage, current?.shareImageMime);
  }
  const bytes = (image: StoredImage | null) =>
    image ? Buffer.from(image.bytes) : null;

  const version = (current?.version ?? 0) + 1;
  await tx.partnerBrand.create({
    data: {
      partnerId,
      version,
      displayName: parsed.data.displayName,
      primaryColor: parsed.data.primaryColor,
      supportEmail: parsed.data.supportEmail,
      supportUrl: parsed.data.supportUrl,
      tagline: parsed.data.tagline,
      footerText: parsed.data.footerText,
      whatsappNumber: parsed.data.whatsappNumber,
      whatsappLabel: parsed.data.whatsappLabel,
      whatsappMessage: parsed.data.whatsappMessage,
      logo: bytes(next.logo),
      logoMime: next.logo?.mime ?? null,
      logoDark: bytes(next.logoDark),
      logoDarkMime: next.logoDark?.mime ?? null,
      favicon: bytes(next.favicon),
      faviconMime: next.favicon?.mime ?? null,
      shareImage: bytes(next.shareImage),
      shareImageMime: next.shareImage?.mime ?? null,
      createdBy: actor.userId,
    },
  });

  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.brand.update",
    resourceType: "partner_brand",
    resourceId: partnerId,
    result: "success",
    origin: "admin",
    metadata: {
      target: "partner_brand",
      from: current ? String(current.version) : "environment",
      to: String(version),
    },
  });

  return { version };
}
