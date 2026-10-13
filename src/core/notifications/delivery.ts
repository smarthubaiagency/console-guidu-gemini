import type { ContextTransaction } from "@/lib/prisma/with-context";

import { notify, type NotificationLanguage } from "./notify";
import { renderNotification } from "./templates";
import type {
  NotificationBrand,
  NotificationEvent,
  NotificationTransport,
} from "./types";

/**
 * Records the delivery once per key, then hands it to the transport and
 * keeps the outcome. Returns 1 for a new delivery, 0 for a repeated key.
 * The message is rendered in the recipient's language (I5); the subject
 * kept is the one sent. Runs in platform jobs (app_worker).
 */
export async function deliverNotification(
  tx: ContextTransaction,
  args: Readonly<{
    transport: NotificationTransport;
    language: NotificationLanguage;
    event: NotificationEvent;
    brand: NotificationBrand;
    partnerId: string;
    relatedId: string;
  }>,
): Promise<number> {
  const { event, brand, language } = args;
  const subject = renderNotification(
    event,
    brand,
    language.locale,
    language.messages,
  ).subject.slice(0, 200);
  const inserted = await tx.$executeRaw`
    insert into public.notification_deliveries
      (partner_id, event_type, recipient_email, subject, idempotency_key, related_id)
    values (${args.partnerId}::uuid, ${event.type}, ${event.recipientEmail}, ${subject},
            ${event.idempotencyKey}, ${args.relatedId}::uuid)
    on conflict (idempotency_key) do nothing
  `;
  if (inserted === 0) return 0;
  let status: "sent" | "skipped" | "failed";
  let reason: string | null;
  try {
    const result = await notify(event, brand, args.transport, language);
    status = result.status;
    reason = result.status === "skipped" ? result.reason : null;
  } catch {
    status = "failed";
    reason = "transport_error";
  }
  await tx.notificationDelivery.updateMany({
    where: { idempotencyKey: event.idempotencyKey, status: "pending" },
    data: { status, reason },
  });
  return 1;
}
