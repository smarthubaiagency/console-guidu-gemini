import "server-only";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { encryptSecret } from "@/core/credentials/crypto";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  isPartnerRole,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import { readCascade } from "@/core/settings/read";
import { resolveSettings } from "@/core/settings/resolve";
import { saveSettings } from "@/core/settings/service";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { googleRedirectUri } from "./provider";
import { GOOGLE_SCOPES, type GoogleScope, GoogleScopeSchema } from "./scopes";

/**
 * Integrações › Google (CF6b): the OAuth app of the platform (the GUIDU's,
 * one Google verification for everybody) and, optionally, one per partner
 * (its brand on the consent screen), plus the scopes offered to the
 * workspaces: the platform turns them on, the partner may only narrow them
 * (`integrations.google.scopes`). The client secret is encrypted on save
 * and never comes back to a page: only its masked copy.
 */

export type GoogleAppActor =
  | Readonly<{ level: "platform"; userId: string; platformRole: string | null }>
  | Readonly<{
      level: "partner";
      userId: string;
      partnerId: string;
      partnerRole: string | null;
    }>;

export const VERIFICATION_STATUSES = [
  "testing",
  "unverified",
  "in_review",
  "verified",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export type GoogleAppSummary = Readonly<{
  clientId: string;
  secretMasked: string;
  verificationStatus: VerificationStatus;
  updatedAt: Date;
}>;

export type GoogleAppView = Readonly<{
  level: "platform" | "partner";
  app: GoogleAppSummary | null;
  /** Read only, from APP_URL; null when APP_URL is missing. */
  redirectUri: string | null;
  /** What the level above offers (the platform: every scope). */
  offeredScopes: GoogleScope[];
  /** What the level's customers get now. */
  scopes: GoogleScope[];
  canEdit: boolean;
}>;

function grants(actor: GoogleAppActor, manage: boolean): boolean {
  if (actor.level === "platform") {
    return (
      actor.platformRole !== null &&
      hasPlatformRolePermission(
        actor.platformRole as PlatformAdminRoleKey,
        Permissions.PLATFORM_SETTINGS_MANAGE,
      )
    );
  }
  return (
    actor.partnerRole !== null &&
    isPartnerRole(actor.partnerRole) &&
    hasPartnerRolePermission(
      actor.partnerRole,
      manage ? Permissions.PARTNER_SETTINGS_MANAGE : Permissions.PARTNER_READ,
    )
  );
}

function invalid(message: string, key: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `integrations.google.errors.${key}`,
  });
}

const partnerOf = (actor: GoogleAppActor) =>
  actor.level === "partner" ? actor.partnerId : null;

async function findApp(tx: ContextTransaction, actor: GoogleAppActor) {
  return tx.googleOauthApp.findFirst({
    where: { partnerId: partnerOf(actor) },
    select: {
      id: true,
      clientId: true,
      clientSecretMasked: true,
      verificationStatus: true,
      updatedAt: true,
    },
  });
}

export async function googleAppView(
  tx: ContextTransaction,
  actor: GoogleAppActor,
): Promise<GoogleAppView> {
  if (!grants(actor, false)) throw new PermissionDeniedError();
  const row = await findApp(tx, actor);
  const rows = await readCascade(tx);
  const effective = resolveSettings(rows).values["integrations.google.scopes"];
  const offered =
    actor.level === "platform"
      ? [...GOOGLE_SCOPES]
      : resolveSettings(rows, { above: "partner" }).values[
          "integrations.google.scopes"
        ];
  return {
    level: actor.level,
    app: row
      ? {
          clientId: row.clientId,
          secretMasked: row.clientSecretMasked,
          verificationStatus: (
            VERIFICATION_STATUSES as readonly string[]
          ).includes(row.verificationStatus)
            ? (row.verificationStatus as VerificationStatus)
            : "testing",
          updatedAt: row.updatedAt,
        }
      : null,
    redirectUri: googleRedirectUri(),
    offeredScopes: offered,
    scopes: effective,
    canEdit: grants(actor, true),
  };
}

const AppInput = z.object({
  clientId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._-]+$/),
  clientSecret: z.string().trim().max(512),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
});

/**
 * Saves the level's app. A new app needs the secret; an existing one keeps
 * its secret when the field comes empty. Audited without the secret.
 */
export async function saveGoogleApp(
  tx: ContextTransaction,
  actor: GoogleAppActor,
  input: unknown,
): Promise<void> {
  if (!grants(actor, true)) throw new PermissionDeniedError();
  const parsed = AppInput.safeParse(input);
  if (!parsed.success) {
    throw invalid(
      "Confira o Client ID e a situação da verificação.",
      "invalid",
    );
  }
  const { clientId, clientSecret, verificationStatus } = parsed.data;
  const current = await findApp(tx, actor);
  if (!current && !clientSecret) {
    throw invalid("Informe o Client Secret do app.", "secretRequired");
  }
  if (clientSecret && clientSecret.length < 8) {
    throw invalid("Client Secret curto demais.", "secretShort");
  }
  const secret = clientSecret ? encryptSecret(clientSecret) : null;
  const fields: string[] = [];
  if (!current) {
    await tx.googleOauthApp.create({
      data: {
        partnerId: partnerOf(actor),
        clientId,
        clientSecretMasked: secret!.maskedValue,
        clientSecretEncrypted: secret!.encryptedPayload,
        verificationStatus,
        updatedBy: actor.userId,
      },
      select: { id: true },
    });
    fields.push("clientId", "clientSecret", "verificationStatus");
  } else {
    if (current.clientId !== clientId) fields.push("clientId");
    if (secret) fields.push("clientSecret");
    if (current.verificationStatus !== verificationStatus) {
      fields.push("verificationStatus");
    }
    if (fields.length === 0) return;
    await tx.googleOauthApp.update({
      where: { id: current.id },
      data: {
        clientId,
        verificationStatus,
        updatedBy: actor.userId,
        updatedAt: new Date(),
        ...(secret
          ? {
              clientSecretMasked: secret.maskedValue,
              clientSecretEncrypted: secret.encryptedPayload,
            }
          : {}),
      },
      select: { id: true },
    });
  }
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: `${actor.level}.google_app.save`,
    resourceType: "google_oauth_app",
    resourceId: partnerOf(actor),
    result: "success",
    origin: "admin",
    metadata: {
      fields,
      status: verificationStatus,
      ...(actor.level === "partner" ? { partnerId: actor.partnerId } : {}),
    },
  });
}

/**
 * Removes the level's app. A partner's customers go back to the GUIDU's
 * app; their connections made with the partner's app stop renewing and
 * must be made again.
 */
export async function deleteGoogleApp(
  tx: ContextTransaction,
  actor: GoogleAppActor,
): Promise<void> {
  if (!grants(actor, true)) throw new PermissionDeniedError();
  const current = await findApp(tx, actor);
  if (!current) return;
  await tx.googleOauthApp.delete({
    where: { id: current.id },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: `${actor.level}.google_app.delete`,
    resourceType: "google_oauth_app",
    resourceId: partnerOf(actor),
    result: "success",
    origin: "admin",
    metadata: actor.level === "partner" ? { partnerId: actor.partnerId } : {},
  });
}

/**
 * Saves the scopes offered to the level's customers. The partner chooses
 * only among the platform's; a choice equal to the level above is stored
 * as "inherit", so a later change above reaches the customers.
 */
export async function saveGoogleScopes(
  tx: ContextTransaction,
  actor: GoogleAppActor,
  input: unknown,
): Promise<void> {
  if (!grants(actor, true)) throw new PermissionDeniedError();
  const parsed = z.array(GoogleScopeSchema).safeParse(input);
  if (!parsed.success) throw invalid("Escopo desconhecido.", "invalid");
  const chosen = GOOGLE_SCOPES.filter((scope) => parsed.data.includes(scope));
  const view = await googleAppView(tx, actor);
  if (chosen.some((scope) => !view.offeredScopes.includes(scope))) {
    throw invalid("Escopo não liberado pela plataforma.", "notOffered");
  }
  const same =
    chosen.length === view.offeredScopes.length &&
    chosen.every((scope) => view.offeredScopes.includes(scope));
  await saveSettings(
    tx,
    actor.level === "platform"
      ? {
          level: "platform",
          userId: actor.userId,
          platformRole: actor.platformRole,
        }
      : {
          level: "partner",
          userId: actor.userId,
          partnerId: actor.partnerId,
          partnerRole: actor.partnerRole,
        },
    { values: { "integrations.google.scopes": same ? null : chosen } },
  );
}
