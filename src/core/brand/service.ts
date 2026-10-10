import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import {
  adminAuditContext,
  requirePlatformPermission,
} from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { checkLogo } from "./logo";
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
});

/** Raw form values; empty or missing optional fields mean "not set". */
export type BrandInput = Readonly<{
  displayName: string;
  primaryColor?: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
}>;

/** keep: reuse the current logo; remove: no logo; bytes: new logo. */
export type LogoChange =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "replace"; bytes: Uint8Array };

const LOGO_ERRORS = {
  empty: "O arquivo do logo está vazio.",
  too_large: "O logo deve ter no máximo 256 KB.",
  unsupported_type: "Use um logo PNG, JPEG ou WebP.",
} as const;

/**
 * Saves a new brand version for the context partner (insert-only history).
 * Platform owner/operations only; RLS repeats the role and partner checks.
 * Must run inside withIdentityContext with that partner's id.
 */
export async function saveBrandVersion(
  tx: ContextTransaction,
  actor: Readonly<{ userId: string; role: PlatformAdminRoleKey | null }>,
  partnerId: string,
  input: BrandInput,
  logoChange: LogoChange,
): Promise<{ version: number }> {
  requirePlatformPermission(actor.role, Permissions.PLATFORM_BRAND_MANAGE);

  const parsed = BrandInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage:
        parsed.error.issues[0]?.message ?? "Dados de marca inválidos.",
    });
  }

  let logo: { bytes: Uint8Array; mime: string } | null = null;
  if (logoChange.kind === "replace") {
    const check = checkLogo(logoChange.bytes);
    if (!check.ok) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: LOGO_ERRORS[check.reason],
      });
    }
    logo = { bytes: logoChange.bytes, mime: check.mime };
  }

  // Serializes versions per partner; the unique key backs it.
  await tx.$executeRaw`
    select pg_advisory_xact_lock(hashtext('partner_brand:' || ${partnerId}::text))
  `;
  const current = await tx.partnerBrand.findFirst({
    where: { partnerId },
    orderBy: { version: "desc" },
    select: { version: true, logo: true, logoMime: true },
  });
  if (logoChange.kind === "keep" && current?.logo && current.logoMime) {
    logo = { bytes: new Uint8Array(current.logo), mime: current.logoMime };
  }

  const version = (current?.version ?? 0) + 1;
  await tx.partnerBrand.create({
    data: {
      partnerId,
      version,
      displayName: parsed.data.displayName,
      primaryColor: parsed.data.primaryColor,
      supportEmail: parsed.data.supportEmail,
      supportUrl: parsed.data.supportUrl,
      logo: logo ? Buffer.from(logo.bytes) : null,
      logoMime: logo?.mime ?? null,
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
