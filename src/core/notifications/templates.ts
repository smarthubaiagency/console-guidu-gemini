import { createTranslator } from "use-intl/core";

import { SOURCE_LOCALE, type Messages } from "@/core/i18n/locales";
import { composeMessages } from "@/core/i18n/messages-loader";

import type {
  NotificationBrand,
  NotificationEvent,
  RenderedMessage,
} from "./types";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

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
    `<p><strong>${escapeHtml(brand.name)}</strong></p>`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`,
    ...support.map((line) => `<p><small>${escapeHtml(line)}</small></p>`),
  ].join("\n");

  return { text, html };
}

/**
 * Renders an event with the partner brand in the recipient's language;
 * all values are escaped. `messages` carries the platform edits.
 */
export function renderNotification(
  event: NotificationEvent,
  brand: NotificationBrand,
  locale: string = SOURCE_LOCALE,
  messages?: Messages,
): RenderedMessage {
  const t = notificationTranslator(locale, messages);
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
  }
}
