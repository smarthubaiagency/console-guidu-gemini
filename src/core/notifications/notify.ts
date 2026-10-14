import type { Messages } from "@/core/i18n/locales";

import type { EmailTemplateContent } from "./template-catalog";
import { renderNotification } from "./templates";
import { getNotificationTransport } from "./transport";
import type {
  NotificationBrand,
  NotificationEvent,
  NotificationTransport,
  SendResult,
} from "./types";

/**
 * Language of a message: its code and, optionally, the edited texts (I5)
 * and the edited template of the event in that language (CF3b).
 */
export type NotificationLanguage = Readonly<{
  locale: string;
  messages?: Messages;
  template?: EmailTemplateContent | null;
}>;

/** Single entry point for user notifications (ADR 0012, P3). */
export async function notify(
  event: NotificationEvent,
  brand: NotificationBrand,
  transport: NotificationTransport = getNotificationTransport(),
  language?: NotificationLanguage,
): Promise<SendResult> {
  const rendered = renderNotification(
    event,
    brand,
    language?.locale,
    language?.messages,
    language?.template,
  );
  return transport.send({
    ...rendered,
    to: event.recipientEmail,
    fromName: brand.sender?.fromName ?? brand.name,
    replyTo: brand.sender?.replyTo ?? brand.supportEmail,
    idempotencyKey: event.idempotencyKey,
    eventType: event.type,
  });
}
