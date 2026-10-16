import type { NotificationLanguage } from "@/core/notifications/notify";
import { notify } from "@/core/notifications/notify";
import type {
  NotificationBrand,
  NotificationEvent,
  NotificationTransport,
  SendResult,
} from "@/core/notifications/types";

import { eventDefinition } from "./catalog";

/**
 * Events the request sends itself (H1): the invitation e-mail and the test
 * e-mail answer the person at once with the outcome (sent, provider off,
 * refused), so they do not wait for `events.dispatch`. The hub's catalog
 * still governs them: only a type marked `inline` with the e-mail channel
 * goes out here; no event row is written for them in H1.
 */
export async function sendInline(
  event: NotificationEvent,
  brand: NotificationBrand,
  transport: NotificationTransport,
  language?: NotificationLanguage,
): Promise<SendResult> {
  const definition = eventDefinition(event.type);
  if (!definition?.inline || !definition.channels.includes("email")) {
    throw new Error(`O evento ${event.type} não é enviado pela requisição.`);
  }
  return notify(event, brand, transport, language);
}
