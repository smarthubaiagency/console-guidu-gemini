import type { Messages } from "@/core/i18n/locales";

import { renderNotification } from "./templates";
import { getNotificationTransport } from "./transport";
import type {
  NotificationBrand,
  NotificationEvent,
  NotificationTransport,
  SendResult,
} from "./types";

/** Language of a message: its code and, optionally, the edited texts (I5). */
export type NotificationLanguage = Readonly<{
  locale: string;
  messages?: Messages;
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
  );
  return transport.send({
    ...rendered,
    to: event.recipientEmail,
    idempotencyKey: event.idempotencyKey,
    eventType: event.type,
  });
}
