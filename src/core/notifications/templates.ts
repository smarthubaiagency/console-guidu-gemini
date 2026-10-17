import { createTranslator } from "use-intl/core";

import { SOURCE_LOCALE, type Messages } from "@/core/i18n/locales";
import { composeMessages } from "@/core/i18n/messages-loader";

import {
  escapeHtml,
  escapeMarkup,
  fillSubject,
  parseMarkup,
  renderMarkupHtml,
  renderMarkupText,
  safeColor,
  type TemplateValues,
} from "./markup";
import type {
  EmailTemplateContent,
  EmailTemplateEvent,
} from "./template-catalog";
import type {
  NotificationBrand,
  NotificationEvent,
  RenderedMessage,
} from "./types";

export { escapeHtml };

/** Message prefix of each workspace deletion notice (WS1). */
const DELETION_PREFIX = {
  "workspace.deletion.scheduled": "workspaceDeletionScheduled",
  "workspace.deletion.reminder": "workspaceDeletionReminder",
  "workspace.deletion.canceled": "workspaceDeletionCanceled",
  "workspace.deletion.completed": "workspaceDeletionCompleted",
} as const;

/** Only absolute http(s) links reach a template. */
function safeLink(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Link de notificação inválido.");
  }
  return url.toString();
}

export type NotificationTranslator = (
  key: string,
  values?: Record<string, string>,
) => string;

const translators = new Map<string, NotificationTranslator>();

/**
 * Translator of the `notifications` namespace in a language (I5). With no
 * `messages`, the shipped files (source, then the language's file); the
 * worker passes the texts with the platform edits (`loadMessagesFor`).
 */
export function notificationTranslator(
  locale: string,
  messages?: Messages,
): NotificationTranslator {
  const cached = messages ? undefined : translators.get(locale);
  if (cached) return cached;
  const t = createTranslator({
    locale,
    messages: (messages ?? composeMessages(locale)) as Record<string, unknown>,
    namespace: "notifications",
  } as Parameters<
    typeof createTranslator
  >[0]) as unknown as NotificationTranslator;
  if (!messages) translators.set(locale, t);
  return t;
}

function formatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    // A platform language code the runtime does not know.
    return new Intl.DateTimeFormat(SOURCE_LOCALE, options);
  }
}

/** Date and time of an instant, in Brasília time. */
function formatDate(locale: string, date: Date): string {
  return formatter(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

/** A calendar day (stored as UTC midnight). */
function formatDay(locale: string, date: Date): string {
  return formatter(locale, { dateStyle: "short", timeZone: "UTC" }).format(
    date,
  );
}

function supportLines(
  t: NotificationTranslator,
  brand: NotificationBrand,
): string[] {
  return [
    brand.supportEmail
      ? t("common.support", { email: brand.supportEmail })
      : null,
    brand.supportUrl
      ? t("common.help", { url: safeLink(brand.supportUrl) })
      : null,
  ].filter((line): line is string => line !== null);
}

/** Support lines of the brand footer in a language (CF3b preview). */
export function brandFooter(
  brand: NotificationBrand,
  locale: string = SOURCE_LOCALE,
): string[] {
  return supportLines(notificationTranslator(locale), brand);
}

function brandHeader(brand: NotificationBrand): string {
  const color = safeColor(brand.color);
  const style = color ? ` style="color:${color}"` : "";
  return `<p><strong${style}>${escapeHtml(brand.name)}</strong></p>`;
}

function layout(
  t: NotificationTranslator,
  brand: NotificationBrand,
  paragraphs: readonly string[],
  action: Readonly<{ label: string; url: string }>,
): Pick<RenderedMessage, "text" | "html"> {
  const support = supportLines(t, brand);
  const text = [
    ...paragraphs,
    "",
    `${action.label}: ${action.url}`,
    "",
    ...support,
    `— ${brand.name}`,
  ].join("\n");

  const html = [
    brandHeader(brand),
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`,
    ...support.map((line) => `<p><small>${escapeHtml(line)}</small></p>`),
  ].join("\n");

  return { text, html };
}

/**
 * Renders an event with the partner brand in the recipient's language;
 * all values are escaped. `messages` carries the platform edits and
 * `template` the edited subject and body of the event (CF3b), when the
 * partner or the platform saved one.
 */
export function renderNotification(
  event: NotificationEvent,
  brand: NotificationBrand,
  locale: string = SOURCE_LOCALE,
  messages?: Messages,
  template?: EmailTemplateContent | null,
): RenderedMessage {
  const t = notificationTranslator(locale, messages);
  if (template) return renderTemplate(t, event, brand, locale, template);
  switch (event.type) {
    case "invitation.created": {
      const url = safeLink(event.data.inviteUrl);
      const names = {
        organization: event.data.organizationName,
        brand: brand.name,
      };
      return {
        subject: t("invitation.subject", names),
        ...layout(
          t,
          brand,
          [
            t("invitation.body", names),
            t("invitation.expires", {
              date: formatDate(locale, event.data.expiresAt),
            }),
          ],
          { label: t("invitation.action"), url },
        ),
      };
    }
    case "billing.subscription.past_due": {
      const { data } = event;
      const organization = data.organizationName;
      return {
        subject: t("pastDue.subject", { organization }),
        ...layout(
          t,
          brand,
          [
            t("common.greeting", { partner: data.partnerName }),
            t("pastDue.body", {
              organization,
              periodEnd: formatDay(locale, data.periodEnd),
            }),
            data.nextStepOn
              ? t("pastDue.nextStep", {
                  date: formatDay(locale, data.nextStepOn),
                })
              : t("pastDue.nextStepUnknown"),
          ],
          { label: t("common.viewBilling"), url: safeLink(data.billingUrl) },
        ),
      };
    }
    case "billing.subscription.suspended": {
      const { data } = event;
      const organization = data.organizationName;
      return {
        subject: t("suspended.subject", { organization }),
        ...layout(
          t,
          brand,
          [
            t("common.greeting", { partner: data.partnerName }),
            t("suspended.body", {
              organization,
              periodEnd: formatDay(locale, data.periodEnd),
            }),
            t("suspended.access"),
          ],
          { label: t("common.viewBilling"), url: safeLink(data.billingUrl) },
        ),
      };
    }
    case "email.test": {
      const names = { brand: brand.name };
      return {
        subject: t("emailTest.subject", names),
        ...layout(t, brand, [t("emailTest.body", names)], {
          label: t("emailTest.action"),
          url: safeLink(event.data.settingsUrl),
        }),
      };
    }
    case "workspace.deletion.scheduled":
    case "workspace.deletion.reminder":
    case "workspace.deletion.canceled":
    case "workspace.deletion.completed": {
      const { data } = event;
      const prefix = DELETION_PREFIX[event.type];
      const values = {
        workspace: data.workspaceName,
        date: formatDate(locale, data.purgeAfter),
      };
      return {
        subject: t(`${prefix}.subject`, values),
        ...layout(
          t,
          brand,
          [t(`${prefix}.body`, values), t(`${prefix}.nextStep`, values)],
          {
            label: t("workspaceDeletion.action"),
            url: safeLink(data.appUrl),
          },
        ),
      };
    }
    case "ai.agent.key_backup":
    case "ai.agent.key_paused": {
      const { data } = event;
      const prefix =
        event.type === "ai.agent.key_backup" ? "aiKeyBackup" : "aiKeyPaused";
      const names = {
        workspace: data.workspaceName,
        agent: data.agentName ?? t("aiKey.unnamedAgent"),
      };
      return {
        subject: t(`${prefix}.subject`, names),
        ...layout(
          t,
          brand,
          [
            t(`${prefix}.body`, names),
            t(`${prefix}.nextStep`, {
              date: formatDate(locale, data.backupUntil),
            }),
          ],
          { label: t("aiKey.action"), url: safeLink(data.credentialsUrl) },
        ),
      };
    }
    case "service_mode.change_requested": {
      const { data } = event;
      const names = {
        organization: data.organizationName,
        partner: data.partnerName,
      };
      return {
        subject: t("serviceModeRequest.subject", names),
        ...layout(
          t,
          brand,
          [
            t("serviceModeRequest.body", names),
            t("serviceModeRequest.scope"),
            t("serviceModeRequest.back"),
            t("serviceModeRequest.expires", {
              date: formatDate(locale, data.expiresAt),
            }),
          ],
          {
            label: t("serviceModeRequest.action"),
            url: safeLink(data.approveUrl),
          },
        ),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Editable templates (CF3b)
// ---------------------------------------------------------------------------

/**
 * Values of an event's variables (`template-catalog.ts`), already formatted
 * in the recipient's language. Links are checked as everywhere else; the
 * renderer escapes every value.
 */
export function templateValues(
  t: NotificationTranslator,
  event: NotificationEvent,
  brand: NotificationBrand,
  locale: string,
): TemplateValues {
  const marca = brand.name;
  switch (event.type) {
    case "invitation.created":
      return {
        organizacao: event.data.organizationName,
        data: formatDate(locale, event.data.expiresAt),
        link: safeLink(event.data.inviteUrl),
        marca,
      };
    case "email.test":
      return { link: safeLink(event.data.settingsUrl), marca };
    case "billing.subscription.past_due":
    case "billing.subscription.suspended": {
      const { data } = event;
      return {
        parceiro: data.partnerName,
        organizacao: data.organizationName,
        vencimento: formatDay(locale, data.periodEnd),
        ...(event.type === "billing.subscription.past_due"
          ? {
              proximo_passo: data.nextStepOn
                ? t("pastDue.nextStep", {
                    date: formatDay(locale, data.nextStepOn),
                  })
                : t("pastDue.nextStepUnknown"),
            }
          : {}),
        link: safeLink(data.billingUrl),
        marca,
      };
    }
    case "workspace.deletion.scheduled":
    case "workspace.deletion.reminder":
    case "workspace.deletion.canceled":
    case "workspace.deletion.completed":
      return {
        workspace: event.data.workspaceName,
        data: formatDate(locale, event.data.purgeAfter),
        link: safeLink(event.data.appUrl),
        marca,
      };
    case "ai.agent.key_backup":
    case "ai.agent.key_paused":
      return {
        workspace: event.data.workspaceName,
        agente: event.data.agentName ?? t("aiKey.unnamedAgent"),
        data: formatDate(locale, event.data.backupUntil),
        link: safeLink(event.data.credentialsUrl),
        marca,
      };
    case "service_mode.change_requested":
      return {
        organizacao: event.data.organizationName,
        parceiro: event.data.partnerName,
        data: formatDate(locale, event.data.expiresAt),
        link: safeLink(event.data.approveUrl),
        marca,
      };
  }
}

function renderTemplate(
  t: NotificationTranslator,
  event: NotificationEvent,
  brand: NotificationBrand,
  locale: string,
  template: EmailTemplateContent,
): RenderedMessage {
  const values = templateValues(t, event, brand, locale);
  const blocks = parseMarkup(template.body);
  const support = supportLines(t, brand);
  const text = [
    renderMarkupText(blocks, values),
    "",
    ...support,
    `— ${brand.name}`,
  ].join("\n");
  const html = [
    brandHeader(brand),
    renderMarkupHtml(blocks, values, { color: brand.color ?? null }),
    ...support.map((line) => `<p><small>${escapeHtml(line)}</small></p>`),
  ].join("\n");
  return { subject: fillSubject(template.subject, values), text, html };
}

// Private-use markers that stand for a tag while a default text is escaped.
const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";

/**
 * The code's template of an event in a language, written in the template
 * format: the same texts the code sends (with the platform edits of
 * `messages`), each value replaced by its `{{tag}}`. It is what the editor
 * shows and what "Restaurar para o padrão" goes back to.
 */
export function defaultEmailTemplate(
  type: EmailTemplateEvent,
  locale: string = SOURCE_LOCALE,
  messages?: Messages,
): EmailTemplateContent {
  const t = notificationTranslator(locale, messages);
  const tags: string[] = [];
  const tag = (name: string) => {
    tags.push(name);
    return `${MARK_OPEN}${tags.length - 1}${MARK_CLOSE}`;
  };
  const restore = (value: string) =>
    value.replace(
      new RegExp(`${MARK_OPEN}(\\d+)${MARK_CLOSE}`, "g"),
      (_, index: string) => `{{${tags[Number(index)]}}}`,
    );
  const paragraph = (value: string) => restore(escapeMarkup(value));
  const action = (label: string) => `[${escapeMarkup(label)}]({{link}})`;
  const build = (subject: string, paragraphs: readonly string[]) => ({
    subject: restore(subject),
    body: paragraphs.join("\n\n"),
  });

  switch (type) {
    case "invitation.created": {
      const names = { organization: tag("organizacao"), brand: tag("marca") };
      return build(t("invitation.subject", names), [
        paragraph(t("invitation.body", names)),
        paragraph(t("invitation.expires", { date: tag("data") })),
        action(t("invitation.action")),
      ]);
    }
    case "email.test": {
      const names = { brand: tag("marca") };
      return build(t("emailTest.subject", names), [
        paragraph(t("emailTest.body", names)),
        action(t("emailTest.action")),
      ]);
    }
    case "billing.subscription.past_due": {
      const organization = tag("organizacao");
      return build(t("pastDue.subject", { organization }), [
        paragraph(t("common.greeting", { partner: tag("parceiro") })),
        paragraph(
          t("pastDue.body", { organization, periodEnd: tag("vencimento") }),
        ),
        "{{proximo_passo}}",
        action(t("common.viewBilling")),
      ]);
    }
    case "billing.subscription.suspended": {
      const organization = tag("organizacao");
      return build(t("suspended.subject", { organization }), [
        paragraph(t("common.greeting", { partner: tag("parceiro") })),
        paragraph(
          t("suspended.body", { organization, periodEnd: tag("vencimento") }),
        ),
        paragraph(t("suspended.access")),
        action(t("common.viewBilling")),
      ]);
    }
    case "workspace.deletion.scheduled":
    case "workspace.deletion.reminder":
    case "workspace.deletion.canceled":
    case "workspace.deletion.completed": {
      const prefix = DELETION_PREFIX[type];
      const values = { workspace: tag("workspace"), date: tag("data") };
      return build(t(`${prefix}.subject`, values), [
        paragraph(t(`${prefix}.body`, values)),
        paragraph(t(`${prefix}.nextStep`, values)),
        action(t("workspaceDeletion.action")),
      ]);
    }
    case "ai.agent.key_backup":
    case "ai.agent.key_paused": {
      const prefix =
        type === "ai.agent.key_backup" ? "aiKeyBackup" : "aiKeyPaused";
      const names = { workspace: tag("workspace"), agent: tag("agente") };
      return build(t(`${prefix}.subject`, names), [
        paragraph(t(`${prefix}.body`, names)),
        paragraph(t(`${prefix}.nextStep`, { date: tag("data") })),
        action(t("aiKey.action")),
      ]);
    }
    case "service_mode.change_requested": {
      const names = {
        organization: tag("organizacao"),
        partner: tag("parceiro"),
      };
      return build(t("serviceModeRequest.subject", names), [
        paragraph(t("serviceModeRequest.body", names)),
        paragraph(t("serviceModeRequest.scope")),
        paragraph(t("serviceModeRequest.back")),
        paragraph(t("serviceModeRequest.expires", { date: tag("data") })),
        action(t("serviceModeRequest.action")),
      ]);
    }
  }
}
