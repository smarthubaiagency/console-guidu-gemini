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

type DeliveryRow = Readonly<{
  id: string;
  status: string;
  attempts: number;
  hold_reason: string | null;
  deliver_after: Date | null;
}>;

/** The delivery row of a key, created once (pending). */
async function deliveryRow(
  tx: ContextTransaction,
  args: Readonly<{
    key: string;
    partnerId: string;
    type: string;
    relatedId: string;
    eventId: string | null;
    userId?: string | null;
  }>,
): Promise<DeliveryRow | null> {
  await tx.$executeRaw`
    insert into public.notification_deliveries
      (partner_id, event_type, idempotency_key, related_id, event_id, channel, recipient_user_id)
    values (${args.partnerId}::uuid, ${args.type}, ${args.key}, ${args.relatedId}::uuid,
            ${args.eventId}::uuid, 'whatsapp', ${args.userId ?? null}::uuid)
    on conflict (idempotency_key) do nothing
  `;
  const [row] = await tx.$queryRaw<DeliveryRow[]>`
    select id, status, attempts, hold_reason, deliver_after
    from public.notification_deliveries where idempotency_key = ${args.key}
  `;
  return row ?? null;
}

async function finishRow(
  tx: ContextTransaction,
  key: string,
  row: DeliveryRow,
  status: "sent" | "skipped" | "failed",
  reason: string | null,
  attempted: boolean,
): Promise<WhatsAppOutcome> {
  const attempts = row.attempts + (attempted ? 1 : 0);
  await tx.$executeRaw`
    update public.notification_deliveries
    set status = ${status}, reason = ${reason}, attempts = ${attempts},
        provider = ${attempted ? "partner_webhook" : null}
    where idempotency_key = ${key}
  `;
  return { status, reason, attempts };
}

/**
 * The signed POST to the webhook of the partner of `webhookEventId` (A6
 * format); the failure reason, or null when delivered.
 */
export async function postToPartnerWebhook(
  tx: ContextTransaction,
  args: Readonly<{
    webhookEventId: string;
    eventId: string | null;
    wireName: string;
    to: string;
    message: Readonly<Record<string, unknown>>;
  }>,
  deps: Readonly<{ fetch?: ChannelFetch; now?: () => Date }> = {},
): Promise<string | null> {
  const now = deps.now ?? (() => new Date());
  const [webhook] = await tx.$queryRaw<
    { url: string; encrypted_secret: string }[]
  >`select url, encrypted_secret from private.event_notice_webhook(${args.webhookEventId}::uuid)`;
  if (!webhook) return "no_webhook";
  const sentAt = now();
  const timestamp = String(Math.floor(sentAt.getTime() / 1000));
  const body = JSON.stringify({
    ...args.message,
    event: args.wireName,
    ...(args.eventId ? { event_id: args.eventId } : {}),
    to: args.to,
    sent_at: sentAt.toISOString(),
  });
  try {
    await providerJson(
      webhook.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-guidu-event": args.wireName,
          ...(args.eventId ? { "x-guidu-event-id": args.eventId } : {}),
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
    if (
      !(error instanceof ChannelHttpError && error.code === "invalid_response")
    ) {
      return failureReason(error);
    }
  }
  return null;
}

async function scheduleRetry(
  tx: ContextTransaction,
  eventId: string,
  attempts: number,
): Promise<void> {
  // A follow-up run tries again; the panel shows the failure meanwhile.
  await tx.$executeRaw`
    insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts, run_after)
    values (${EVENTS_DISPATCH_JOB_KIND}, 'platform', ${JSON.stringify({ eventId })}::jsonb,
            ${`event:${eventId}:retry:${attempts}`}, 3,
            now() + make_interval(secs => ${RETRY_DELAY_SECONDS * attempts}))
    on conflict (kind, idempotency_key) do nothing
  `;
}

export async function deliverWhatsApp(
  tx: ContextTransaction,
  event: WhatsAppEvent,
  deps: Readonly<{ fetch?: ChannelFetch; now?: () => Date }> = {},
): Promise<WhatsAppOutcome> {
  const key = `${event.idempotencyKey}:whatsapp`.slice(0, 200);
  const relatedId =
    event.subjectId && UUID.test(event.subjectId) ? event.subjectId : event.id;
  const row = await deliveryRow(tx, {
    key,
    partnerId: event.partnerId,
    type: event.type,
    relatedId,
    eventId: event.id,
  });
  if (!row || !["pending", "queued", "failed"].includes(row.status)) {
    return { status: "done", reason: null, attempts: row?.attempts ?? 0 };
  }
  if (row.attempts >= WHATSAPP_MAX_ATTEMPTS) {
    return { status: "done", reason: null, attempts: row.attempts };
  }

  const target = whatsAppTargetOf(event.data);
  if (!target) return finishRow(tx, key, row, "skipped", "no_target", false);
  if (target.skip) return finishRow(tx, key, row, "skipped", target.skip, false);
  if (!target.to) return finishRow(tx, key, row, "skipped", "no_recipient", false);

  const failure = await postToPartnerWebhook(
    tx,
    {
      webhookEventId: event.id,
      eventId: event.id,
      wireName: target.name ?? event.type,
      to: target.to,
      message: target.message,
    },
    deps,
  );
  if (failure === "no_webhook") {
    return finishRow(tx, key, row, "skipped", "no_webhook", false);
  }
  if (!failure) return finishRow(tx, key, row, "sent", null, true);
  const outcome = await finishRow(tx, key, row, "failed", failure, true);
  if (outcome.attempts < WHATSAPP_MAX_ATTEMPTS) {
    await scheduleRetry(tx, event.id, outcome.attempts);
  }
  return outcome;
}

/** A WhatsApp to a person of the audience (H2). */
export type PersonWhatsApp = Readonly<{
  event: WhatsAppEvent;
  userId: string;
  /** The person's accepted number, or null without number or consent. */
  phone: string | null;
  text: string;
  /** Held until this moment (quiet window or digest). */
  hold?: Readonly<{ reason: "quiet_hours" | "digest"; until: Date }> | null;
}>;

export type PersonWhatsAppOutcome = Readonly<{
  status: WhatsAppOutcome["status"] | "held";
  reason: string | null;
}>;

/**
 * The WhatsApp of one person (H2): skipped without an accepted number,
 * held (queued) inside the quiet window or for the digest, else sent by
 * the partner's webhook with `event` = the catalog type and the rendered
 * `text`. Each person has one delivery per event; a failure comes back
 * with the event's follow-up run.
 */
export async function deliverPersonWhatsApp(
  tx: ContextTransaction,
  args: PersonWhatsApp,
  deps: Readonly<{ fetch?: ChannelFetch; now?: () => Date }> = {},
): Promise<PersonWhatsAppOutcome> {
  const now = deps.now ?? (() => new Date());
  const { event } = args;
  const key = `${event.idempotencyKey}:whatsapp:user:${args.userId}`.slice(0, 200);
  const relatedId =
    event.subjectId && UUID.test(event.subjectId) ? event.subjectId : event.id;
  const row = await deliveryRow(tx, {
    key,
    partnerId: event.partnerId,
    type: event.type,
    relatedId,
    eventId: event.id,
    userId: args.userId,
  });
  if (!row || !["pending", "queued", "failed"].includes(row.status)) {
    return { status: "done", reason: null };
  }
  if (row.attempts >= WHATSAPP_MAX_ATTEMPTS) return { status: "done", reason: null };
  if (row.status === "queued" && row.hold_reason) {
    if (row.deliver_after && row.deliver_after.getTime() > now().getTime()) {
      return { status: "held", reason: row.hold_reason };
    }
  }
  if (!args.phone) {
    return finishRow(tx, key, row, "skipped", "no_whatsapp_consent", false);
  }
  if (args.hold && row.status === "pending") {
    await tx.$executeRaw`
      update public.notification_deliveries
      set status = 'queued', hold_reason = ${args.hold.reason},
          deliver_after = ${args.hold.until}, reason = ${args.hold.reason}
      where idempotency_key = ${key}
    `;
    return { status: "held", reason: args.hold.reason };
  }
  const failure = await postToPartnerWebhook(
    tx,
    {
      webhookEventId: event.id,
      eventId: event.id,
      wireName: event.type,
      to: args.phone,
      message: { text: args.text },
    },
    deps,
  );
  if (failure === "no_webhook") {
    return finishRow(tx, key, row, "skipped", "no_webhook", false);
  }
  if (!failure) return finishRow(tx, key, row, "sent", null, true);
  const outcome = await finishRow(tx, key, row, "failed", failure, true);
  if (outcome.attempts < WHATSAPP_MAX_ATTEMPTS) {
    await scheduleRetry(tx, event.id, outcome.attempts);
  }
  return outcome;
}
