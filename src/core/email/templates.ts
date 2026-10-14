import "server-only";

import { recordAudit } from "@/core/audit/record";
import { BUILT_IN_LOCALES, type Messages } from "@/core/i18n/locales";
import { adminAuditContext } from "@/core/module-runtime/settings";
import {
  validateTemplate,
  type TemplateIssue,
} from "@/core/notifications/markup";
import {
  EMAIL_TEMPLATE_EVENTS,
  emailTemplateDefinition,
  type EmailTemplateContent,
  type EmailTemplateDefinition,
} from "@/core/notifications/template-catalog";
import { emailTemplateFor } from "@/core/notifications/template-store";
import { defaultEmailTemplate } from "@/core/notifications/templates";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  isPartnerRole,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

/**
 * Configurações › E-mail › Modelos (CF3b): the platform edits the base over
 * the code's templates, each partner overrides it for its customers.
 * Writes go through `email_templates` inside the identity context; RLS
 * repeats every check made here.
 */

export type EmailTemplateActor =
  | Readonly<{
      level: "platform";
      userId: string;
      platformRole: string | null;
    }>
  | Readonly<{
      level: "partner";
      userId: string;
      partnerId: string;
      partnerRole: string | null;
    }>;

/** A template saved at the actor's level. */
export type OwnEmailTemplate = EmailTemplateContent &
  Readonly<{ eventType: string; locale: string; updatedAt: Date }>;

/** Languages with a tab on the screen: the ones shipped with the code. */
export const TEMPLATE_LOCALES: readonly string[] = BUILT_IN_LOCALES;

/** A field of the template refused on save, with its translated key. */
export class EmailTemplateInvalidError extends AppError {
  readonly field: TemplateIssue["field"];

  constructor(issue: TemplateIssue) {
    super({
      code: "invalid_input",
      safeMessage: "Modelo de e-mail inválido.",
      messageKey: `email.templates.errors.${issue.code}`,
      messageValues: { tag: issue.tag ?? "" },
    });
    this.field = issue.field;
  }
}

function invalid(key: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: "Modelo de e-mail desconhecido.",
    messageKey: `email.templates.errors.${key}`,
  });
}

export function canManageEmailTemplates(actor: EmailTemplateActor): boolean {
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
      Permissions.PARTNER_SETTINGS_MANAGE,
    )
  );
}

function scopeOf(actor: EmailTemplateActor) {
  return actor.level === "platform"
    ? { scope: "platform", partnerId: null }
    : { scope: "partner", partnerId: actor.partnerId };
}

/** The templates saved at the actor's level. */
export async function listOwnEmailTemplates(
  tx: ContextTransaction,
  actor: EmailTemplateActor,
): Promise<OwnEmailTemplate[]> {
  const rows = await tx.emailTemplate.findMany({
    where: scopeOf(actor),
    select: {
      eventType: true,
      locale: true,
      subject: true,
      body: true,
      updatedAt: true,
    },
  });
  return rows;
}

/**
 * What the level gets without a template of its own: for the platform, the
 * code's; for a partner, the platform's base or else the code's.
 */
export async function inheritedEmailTemplate(
  tx: ContextTransaction,
  actor: EmailTemplateActor,
  eventType: EmailTemplateDefinition["type"],
  locale: string,
  messages?: Messages,
): Promise<EmailTemplateContent & Readonly<{ source: "code" | "platform" }>> {
  if (actor.level === "partner") {
    const platform = await emailTemplateFor(tx, null, eventType, locale);
    if (platform) {
      return {
        subject: platform.subject,
        body: platform.body,
        source: "platform",
      };
    }
  }
  return {
    ...defaultEmailTemplate(eventType, locale, messages),
    source: "code",
  };
}

export type EmailTemplateInput = Readonly<{
  eventType: string;
  locale: string;
  subject: string;
  body: string;
}>;

function checkTarget(
  eventType: string,
  locale: string,
): EmailTemplateDefinition {
  const definition = emailTemplateDefinition(eventType);
  if (!definition) throw invalid("unknownEvent");
  if (!TEMPLATE_LOCALES.includes(locale)) throw invalid("unknownLocale");
  return definition;
}

/**
 * Saves the level's template of an event in a language. Unknown tags,
 * links that are not http(s) (or a link variable) and oversized fields are
 * refused; the body is kept in the template format, never as HTML.
 */
export async function saveEmailTemplate(
  tx: ContextTransaction,
  actor: EmailTemplateActor,
  input: EmailTemplateInput,
): Promise<void> {
  if (!canManageEmailTemplates(actor)) throw new PermissionDeniedError();
  const definition = checkTarget(input.eventType, input.locale);
  const content = {
    subject: input.subject.trim(),
    body: input.body.replace(/\r\n?/g, "\n").trimEnd(),
  };
  const [issue] = validateTemplate(content, definition.variables);
  if (issue) throw new EmailTemplateInvalidError(issue);

  const scope = scopeOf(actor);
  const where = { ...scope, eventType: definition.type, locale: input.locale };
  const updated = await tx.emailTemplate.updateMany({
    where,
    data: { ...content, updatedBy: actor.userId },
  });
  if (updated.count === 0) {
    await tx.emailTemplate.create({
      data: { ...where, ...content, updatedBy: actor.userId },
    });
  }
  await audit(tx, actor, "save", definition.type, input.locale);
}

/** "Restaurar para o padrão": removes the level's template. */
export async function restoreEmailTemplate(
  tx: ContextTransaction,
  actor: EmailTemplateActor,
  input: Readonly<{ eventType: string; locale: string }>,
): Promise<boolean> {
  if (!canManageEmailTemplates(actor)) throw new PermissionDeniedError();
  const definition = checkTarget(input.eventType, input.locale);
  const removed = await tx.emailTemplate.deleteMany({
    where: {
      ...scopeOf(actor),
      eventType: definition.type,
      locale: input.locale,
    },
  });
  if (removed.count > 0) {
    await audit(tx, actor, "restore", definition.type, input.locale);
  }
  return removed.count > 0;
}

async function audit(
  tx: ContextTransaction,
  actor: EmailTemplateActor,
  what: "save" | "restore",
  eventType: string,
  locale: string,
): Promise<void> {
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: `${actor.level}.email_template.${what}`,
    resourceType: "email_template",
    resourceId: `${eventType}:${locale}`,
    result: "success",
    origin: "admin",
    metadata: {
      target: eventType,
      ...(actor.level === "partner" ? { partnerId: actor.partnerId } : {}),
    },
  });
}

export type EmailTemplatesData = Readonly<{
  /** The selected event (the first one when the URL names none). */
  eventType: EmailTemplateDefinition["type"];
  own: OwnEmailTemplate[];
  /** What the level inherits for the selected event, by language. */
  inherited: Readonly<
    Record<
      string,
      EmailTemplateContent & Readonly<{ source: "code" | "platform" }>
    >
  >;
}>;

/** Everything the templates page shows, read in the page's context. */
export async function loadEmailTemplates(
  tx: ContextTransaction,
  actor: EmailTemplateActor,
  selected: string | undefined,
): Promise<EmailTemplatesData> {
  const definition =
    emailTemplateDefinition(selected ?? "") ?? EMAIL_TEMPLATE_EVENTS[0]!;
  const own = await listOwnEmailTemplates(tx, actor);
  const inherited: Record<
    string,
    EmailTemplateContent & Readonly<{ source: "code" | "platform" }>
  > = {};
  for (const locale of TEMPLATE_LOCALES) {
    inherited[locale] = await inheritedEmailTemplate(
      tx,
      actor,
      definition.type,
      locale,
    );
  }
  return { eventType: definition.type, own, inherited };
}
