import "server-only";

import { recordAudit } from "@/core/audit/record";
import { SOURCE_LOCALE, type Messages } from "@/core/i18n/locales";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  isPartnerRole,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  defaultWhatsappText,
  isWhatsappTextType,
  unknownTags,
  WHATSAPP_TEXT_MAX,
} from "./texts";

/**
 * WhatsApp texts of the hub's notices to people (H2), versioned like the
 * legacy `notification_mappings`: per event and language, at the platform
 * (the base) and at the partner (for its customers). Each edit inserts a
 * new version and the previous one stops being current; "restore the
 * default" only retires the current version, so the history stays whole.
 * Sending uses the partner's current text, else the platform's, else the
 * code's (`notifications.whatsapp.*`).
 */

export type TemplatesActor =
  | Readonly<{
      level: "platform";
      userId: string;
      platformRole: PlatformAdminRoleKey | null;
    }>
  | Readonly<{
      level: "partner";
      userId: string;
      partnerId: string;
      partnerRole: string | null;
    }>;

export type WhatsappTemplateVersion = Readonly<{
  id: string;
  version: number;
  body: string;
  isCurrent: boolean;
  createdBy: string | null;
  createdAt: Date;
}>;

function denied(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não tem permissão para esta ação.",
    messageKey: "eventRules.errors.forbidden",
  });
}

function invalid(
  key: string,
  message: string,
  values?: Record<string, string>,
) {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `eventRules.errors.${key}`,
    ...(values ? { messageValues: values } : {}),
  });
}

export function canEditTemplates(actor: TemplatesActor): boolean {
  if (actor.level === "platform") {
    return (
      actor.platformRole !== null &&
      hasPlatformRolePermission(
        actor.platformRole,
        Permissions.PLATFORM_SETTINGS_MANAGE,
      )
    );
  }
  return (
    actor.partnerRole !== null &&
    isPartnerRole(actor.partnerRole) &&
    hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_SETTINGS_MANAGE,
    )
  );
}

const LOCALE = /^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$/;

function scopeSql(actor: TemplatesActor) {
  return actor.level === "platform"
    ? { scope: "platform", partnerId: null }
    : { scope: "partner", partnerId: actor.partnerId };
}

/** Every version of the level for an event and language, newest first. */
export async function templateVersions(
  tx: ContextTransaction,
  actor: TemplatesActor,
  eventType: string,
  locale: string,
): Promise<WhatsappTemplateVersion[]> {
  const { scope, partnerId } = scopeSql(actor);
  const rows = await tx.$queryRaw<
    {
      id: string;
      version: number;
      body: string;
      is_current: boolean;
      created_by: string | null;
      created_at: Date;
    }[]
  >`
    select id, version, body, is_current, created_by, created_at
    from public.whatsapp_templates
    where scope = ${scope} and partner_id is not distinct from ${partnerId}::uuid
      and event_type = ${eventType} and locale = ${locale}
    order by version desc limit 50
  `;
  return rows.map((row) => ({
    id: row.id,
    version: Number(row.version),
    body: row.body,
    isCurrent: row.is_current,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

/** The text the level sees as current: its own, the one above, or the code's. */
export async function effectiveTemplate(
  tx: ContextTransaction,
  actor: TemplatesActor,
  eventType: string,
  locale: string,
  messages?: Messages,
): Promise<Readonly<{ body: string; source: "own" | "platform" | "default" }>> {
  const [row] = await tx.$queryRaw<{ scope: string; body: string }[]>`
    select scope, body from private.whatsapp_template(
      ${actor.level === "partner" ? actor.partnerId : null}::uuid, ${eventType}, ${locale})
  `;
  if (row && row.scope === actor.level)
    return { body: row.body, source: "own" };
  if (row) return { body: row.body, source: "platform" };
  return {
    body: defaultWhatsappText(eventType, locale ?? SOURCE_LOCALE, messages),
    source: "default",
  };
}

function check(eventType: string, locale: string, body: string): string {
  if (!isWhatsappTextType(eventType) || !LOCALE.test(locale)) {
    throw invalid("template", "Modelo desconhecido.");
  }
  const text = body.trim();
  if (text.length < 1 || text.length > WHATSAPP_TEXT_MAX) {
    throw invalid("templateSize", "O texto vai de 1 a 1000 caracteres.");
  }
  const unknown = unknownTags(eventType, text);
  if (unknown.length > 0) {
    throw invalid("templateTags", "Variável desconhecida: {tags}.", {
      tags: unknown.map((tag) => `{{${tag}}}`).join(", "),
    });
  }
  return text;
}

/** Saves a new current version (the previous one stays in the history). */
export async function saveTemplateVersion(
  tx: ContextTransaction,
  actor: TemplatesActor,
  input: Readonly<{ eventType: string; locale: string; body: string }>,
): Promise<number> {
  if (!canEditTemplates(actor)) throw denied();
  const body = check(input.eventType, input.locale, input.body);
  const { scope, partnerId } = scopeSql(actor);
  const [current] = await tx.$queryRaw<{ id: string; body: string }[]>`
    select id, body from public.whatsapp_templates
    where scope = ${scope} and partner_id is not distinct from ${partnerId}::uuid
      and event_type = ${input.eventType} and locale = ${input.locale} and is_current
  `;
  if (current?.body === body) {
    const [same] = await tx.$queryRaw<{ version: number }[]>`
      select version from public.whatsapp_templates where id = ${current.id}::uuid
    `;
    return Number(same?.version ?? 1);
  }
  const [last] = await tx.$queryRaw<{ version: number | null }[]>`
    select max(version) as version from public.whatsapp_templates
    where scope = ${scope} and partner_id is not distinct from ${partnerId}::uuid
      and event_type = ${input.eventType} and locale = ${input.locale}
  `;
  const version = Number(last?.version ?? 0) + 1;
  if (current) {
    await tx.$executeRaw`
      update public.whatsapp_templates set is_current = false where id = ${current.id}::uuid
    `;
  }
  await tx.$executeRaw`
    insert into public.whatsapp_templates
      (scope, partner_id, event_type, locale, version, body, is_current, parent_id, created_by)
    values (${scope}, ${partnerId}::uuid, ${input.eventType}, ${input.locale}, ${version},
            ${body}, true, ${current?.id ?? null}::uuid, ${actor.userId}::uuid)
  `;
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: `${actor.level}.whatsapp_template.save`,
    resourceType: "whatsapp_template",
    resourceId: `${input.eventType}:${input.locale}`,
    result: "success",
    origin: "admin",
    metadata: {
      eventType: input.eventType,
      version,
      ...(actor.level === "partner" ? { partnerId: actor.partnerId } : {}),
    },
  });
  return version;
}

/** Goes back to the level above (or the code's text); history kept. */
export async function restoreTemplateDefault(
  tx: ContextTransaction,
  actor: TemplatesActor,
  input: Readonly<{ eventType: string; locale: string }>,
): Promise<boolean> {
  if (!canEditTemplates(actor)) throw denied();
  if (!isWhatsappTextType(input.eventType) || !LOCALE.test(input.locale)) {
    throw invalid("template", "Modelo desconhecido.");
  }
  const { scope, partnerId } = scopeSql(actor);
  const changed = await tx.$executeRaw`
    update public.whatsapp_templates set is_current = false
    where scope = ${scope} and partner_id is not distinct from ${partnerId}::uuid
      and event_type = ${input.eventType} and locale = ${input.locale} and is_current
  `;
  if (changed > 0) {
    await recordAudit(tx, adminAuditContext(actor.userId), {
      action: `${actor.level}.whatsapp_template.restore`,
      resourceType: "whatsapp_template",
      resourceId: `${input.eventType}:${input.locale}`,
      result: "success",
      origin: "admin",
      metadata: {
        eventType: input.eventType,
        ...(actor.level === "partner" ? { partnerId: actor.partnerId } : {}),
      },
    });
  }
  return changed > 0;
}
