import "server-only";

import { createHmac } from "node:crypto";

import {
  ChannelHttpError,
  type ChannelFetch,
  providerJson,
} from "@/core/channels/http";
import { decryptSecret } from "@/core/credentials/crypto";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { EVENTS_DISPATCH_JOB_KIND } from "./emit";

/**
 * WhatsApp channel of the Event Hub (H1): a signed POST to the webhook of
 * the partner that owns the event's company, in the A6 format
 * (`x-guidu-signature: sha256=<hmac of "<timestamp>.<body>">`); the
 * partner's flow sends the message from the merchant's Assistant number
 * (Marcelo, 14/10/2026). The body carries `event` (the type) and
 * `event_id`. No webhook, no number or a reason written by the module →
 * the delivery is kept as `skipped` with the reason. A failure is kept as
 * `failed` and tried again by a follow-up run, up to 3 attempts.
 */

export const WHATSAPP_MAX_ATTEMPTS = 3;
const RETRY_DELAY_SECONDS = 60;

const WIRE_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** What an event of the `explicit` route carries for the channel. */
export type WhatsAppTarget = Readonly<{
  /** The number to tell (e.g. the agent's `owner_phone`). */
  to: string | null;
  /** A reason the module already knows it cannot be sent. */
  skip?: string | null;
  /** Fields of the body besides `event`, `event_id`, `to` and `sent_at`. */
  message: Readonly<Record<string, unknown>>;
  /**
   * The `event` name the partner's flow already knows (A6: `lead.hot`,
   * `referral.recommended`); null sends the catalog type. Keeps the
   * webhook contract of the partners unchanged by the hub.
   */
  name?: string | null;
}>;

export type WhatsAppOutcome = Readonly<{
  status: "sent" | "skipped" | "failed" | "done";
  reason: string | null;
  attempts: number;
}>;

export type WhatsAppEvent = Readonly<{
  id: string;
  type: string;
  partnerId: string;
  subjectId: string | null;
  idempotencyKey: string;
  data: Readonly<Record<string, unknown>>;
}>;

/** `sha256=<hex>` of `<timestamp>.<body>` with the partner's secret (A6). */
export function signWebhookBody(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}

export function whatsAppTargetOf(
  data: Readonly<Record<string, unknown>>,
): WhatsAppTarget | null {
  const raw = data.whatsapp;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const target = raw as Record<string, unknown>;
  const message =
    target.message &&
    typeof target.message === "object" &&
    !Array.isArray(target.message)
      ? (target.message as Record<string, unknown>)
      : {};
  return {
    to: typeof target.to === "string" && target.to.trim() ? target.to : null,
    skip: typeof target.skip === "string" ? target.skip.slice(0, 80) : null,
    message,
    name:
      typeof target.name === "string" && WIRE_NAME.test(target.name)
        ? target.name
        : null,
  };
}

function failureReason(error: unknown): string {
  if (error instanceof ChannelHttpError) {
    return error.status ? `http_${error.status}` : error.code;
  }
  return "network";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function deliverWhatsApp(
  tx: ContextTransaction,
  event: WhatsAppEvent,
  deps: Readonly<{ fetch?: ChannelFetch; now?: () => Date }> = {},
): Promise<WhatsAppOutcome> {
  const now = deps.now ?? (() => new Date());
  const key = `${event.idempotencyKey}:whatsapp`.slice(0, 200);
  const relatedId =
    event.subjectId && UUID.test(event.subjectId) ? event.subjectId : event.id;
  await tx.$executeRaw`
    insert into public.notification_deliveries
      (partner_id, event_type, idempotency_key, related_id, event_id, channel)
    values (${event.partnerId}::uuid, ${event.type}, ${key}, ${relatedId}::uuid,
            ${event.id}::uuid, 'whatsapp')
    on conflict (idempotency_key) do nothing
  `;
  const [row] = await tx.$queryRaw<{ status: string; attempts: number }[]>`
    select status, attempts from public.notification_deliveries where idempotency_key = ${key}
  `;
  if (!row || !["pending", "queued", "failed"].includes(row.status)) {
    return { status: "done", reason: null, attempts: row?.attempts ?? 0 };
  }
  if (row.attempts >= WHATSAPP_MAX_ATTEMPTS) {
    return { status: "done", reason: null, attempts: row.attempts };
  }
  const finish = async (
    status: "sent" | "skipped" | "failed",
    reason: string | null,
    attempted: boolean,
  ): Promise<WhatsAppOutcome> => {
    const attempts = row.attempts + (attempted ? 1 : 0);
    await tx.$executeRaw`
      update public.notification_deliveries
      set status = ${status}, reason = ${reason}, attempts = ${attempts},
          provider = ${attempted ? "partner_webhook" : null}
      where idempotency_key = ${key}
    `;
    return { status, reason, attempts };
  };

  const target = whatsAppTargetOf(event.data);
  if (!target) return finish("skipped", "no_target", false);
  if (target.skip) return finish("skipped", target.skip, false);
  if (!target.to) return finish("skipped", "no_recipient", false);
  const [webhook] = await tx.$queryRaw<
    { url: string; encrypted_secret: string }[]
  >`select url, encrypted_secret from private.event_notice_webhook(${event.id}::uuid)`;
  if (!webhook) return finish("skipped", "no_webhook", false);

  const sentAt = now();
  const timestamp = String(Math.floor(sentAt.getTime() / 1000));
  const wireName = target.name ?? event.type;
  const body = JSON.stringify({
    ...target.message,
    event: wireName,
    event_id: event.id,
    to: target.to,
    sent_at: sentAt.toISOString(),
  });
  let failure: string | null = null;
  try {
    await providerJson(
      webhook.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-guidu-event": wireName,
          "x-guidu-event-id": event.id,
          "x-guidu-timestamp": timestamp,
          "x-guidu-signature": signWebhookBody(
            decryptSecret(webhook.encrypted_secret),
            timestamp,
            body,
          ),
        },
        body,
      },
      deps.fetch ? { fetch: deps.fetch } : {},
    );
  } catch (error) {
    // A 2xx answer that is not JSON is still a delivery.
    if (!(
      error instanceof ChannelHttpError && error.code === "invalid_response"
    )) {
      failure = failureReason(error);
    }
  }
  if (!failure) return finish("sent", null, true);
  const outcome = await finish("failed", failure, true);
  if (outcome.attempts < WHATSAPP_MAX_ATTEMPTS) {
    // A follow-up run tries again; the panel shows the failure meanwhile.
    await tx.$executeRaw`
      insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts, run_after)
      values (${EVENTS_DISPATCH_JOB_KIND}, 'platform', ${JSON.stringify({ eventId: event.id })}::jsonb,
              ${`event:${event.id}:retry:${outcome.attempts}`}, 3,
              now() + make_interval(secs => ${RETRY_DELAY_SECONDS * outcome.attempts}))
      on conflict (kind, idempotency_key) do nothing
    `;
  }
  return outcome;
}
