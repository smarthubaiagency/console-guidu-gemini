import type { ContextTransaction } from "@/lib/prisma/with-context";

import { channelsFor, postNotice } from "./inbox";
import { inboxNotice } from "./inbox-content";
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
 * Records the delivery once per key, then distributes it to the channels
 * (CF3c): the bell of the recipient, when the worker knows the person
 * (`recipientUserId`), and the e-mail through the transport, keeping the
 * outcome. Each channel follows the person's preferences, except for
 * essential events; an e-mail turned off is kept as "skipped / opted_out".
 * Returns 1 for a new delivery, 0 for a repeated key.
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
    /** The person of the address, when known: their bell and preferences. */
    recipientUserId?: string | null;
    /** The Event Hub event of the delivery (H1), kept with it. */
    eventId?: string | null;
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
  const userId = args.recipientUserId ?? null;
  const eventId = args.eventId ?? null;
  const inserted = await tx.$executeRaw`
    insert into public.notification_deliveries
      (partner_id, event_type, recipient_email, subject, idempotency_key, related_id,
       event_id, channel, recipient_user_id)
    values (${args.partnerId}::uuid, ${event.type}, ${event.recipientEmail}, ${subject},
            ${event.idempotencyKey}, ${args.relatedId}::uuid,
            ${eventId}::uuid, 'email', ${userId}::uuid)
    on conflict (idempotency_key) do nothing
  `;
  if (inserted === 0) return 0;

  const channels = await channelsFor(tx, userId, event.type);
  const notice = channels.has("app") ? inboxNotice(event) : null;
  if (userId && notice) {
    await postNotice(tx, {
      userId,
      notice,
      idempotencyKey: event.idempotencyKey,
    });
  }

  let status: "sent" | "skipped" | "failed";
  let reason: string | null;
  if (!channels.has("email")) {
    await tx.notificationDelivery.updateMany({
      where: { idempotencyKey: event.idempotencyKey, status: "pending" },
      data: { status: "skipped", reason: "opted_out" },
    });
    return 1;
  }
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
    data: {
      status,
      reason,
      attempts: 1,
      provider: status === "skipped" ? null : (args.transport.provider ?? null),
    },
  });
  return 1;
}
