import { renderNotification } from "./templates";
import { getNotificationTransport } from "./transport";
import type {
  NotificationBrand,
  NotificationEvent,
  NotificationTransport,
  SendResult,
} from "./types";

/** Single entry point for user notifications (ADR 0012, P3). */
export async function notify(
  event: NotificationEvent,
  brand: NotificationBrand,
  transport: NotificationTransport = getNotificationTransport(),
): Promise<SendResult> {
  const rendered = renderNotification(event, brand);
  return transport.send({
    ...rendered,
    to: event.recipientEmail,
    idempotencyKey: event.idempotencyKey,
    eventType: event.type,
  });
}
