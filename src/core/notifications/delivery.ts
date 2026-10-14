import type { ContextTransaction } from "@/lib/prisma/with-context";

import { notify, type NotificationLanguage } from "./notify";
import { withSender } from "./sender";
import { emailTemplateFor } from "./template-store";
import { renderNotification } from "./templates";
import {
  EmailSendError,
  type NotificationBrand,
  type NotificationEvent,
  type NotificationTransport,
} from "./types";

/**
 * Records the delivery once per key, then hands it to the transport and
 * keeps the outcome. Returns 1 for a new delivery, 0 for a repeated key.
 * The message is rendered in the recipient's language (I5); the subject
 * kept is the one sent. The sender is the one of `senderPartnerId` (the
 * partner whose brand the e-mail carries; null for the platform's brand),
 * and so is the template (CF3b): that partner's, else the platform's, else
 * the code's. Runs in platform jobs (app_worker).
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
    senderPartnerId?: string | null;
  }>,
): Promise<number> {
  const { event } = args;
  const senderPartnerId = args.senderPartnerId ?? null;
  const brand = await withSender(tx, senderPartnerId, args.brand);
  const language: NotificationLanguage = {
    ...args.language,
    template: await emailTemplateFor(
      tx,
      senderPartnerId,
      event.type,
      args.language.locale,
    ),
  };
  const subject = renderNotification(
    event,
    brand,
    language.locale,
    language.messages,
    language.template,
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
  } catch (err) {
    status = "failed";
    reason =
      err instanceof EmailSendError
        ? `provider:${err.status ?? "network"}:${err.code}`
        : "transport_error";
  }
  await tx.notificationDelivery.updateMany({
    where: { idempotencyKey: event.idempotencyKey, status: "pending" },
    data: { status, reason },
  });
  return 1;
}
