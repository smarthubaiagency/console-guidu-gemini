import "server-only";

import { createHmac } from "node:crypto";

import {
  LEAD_NOTICE_EVENT_TYPES,
  recordLeadNoticeOutcome,
} from "@/core/ai/notices/hub";
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
 *
 * H4: the HTTP call never runs inside a database transaction. Sending
 * has three steps:
 * 1. the claim (in the dispatch's transaction): the delivery becomes
 *    `sending`, with `sending_at` and one more attempt, and commits;
 * 2. the POST to the partner (`postWhatsApp`), with no transaction open;
 * 3. the result (`recordWhatsAppResult`), in a transaction of its own:
 *    `sent`, or `failed` with the next run scheduled.
 * A process that dies between 1 and 3 leaves the delivery in `sending`;
 * `events.notices-tick` takes it back after a timeout and it goes again
 * with the same delivery id, sent in `x-guidu-delivery-id` (next to
 * `x-guidu-event-id`) so the partner can drop a repeat. The A6 contract
 * (`lead.hot`, `referral.recommended`) keeps its body and headers.
 *
 * A caller that holds a transaction it cannot leave (a job that dispatches
 * in its own run) uses `whatsapp: "defer"`: the delivery stays pending and
 * a follow-up `events.dispatch` run sends it.
 */

export const WHATSAPP_MAX_ATTEMPTS = 3;
const RETRY_DELAY_SECONDS = 60;
/** A delivery left `sending` longer than this is taken back by the tick. */
export const WHATSAPP_SENDING_TIMEOUT_MINUTES = 10;

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

/** How a caller sends: claim and return the send, or leave it pending. */
export type WhatsAppMode = "claim" | "defer";

/** A claimed delivery, ready for the POST outside the transaction. */
export type WhatsAppSend = Readonly<{
  /** Stable across retries: `x-guidu-delivery-id`. */
  deliveryId: string;
  /** The rows of the delivery (several for a digest). */
  deliveryIds: readonly string[];
  /** The event to dispatch again after a failure (none for a digest). */
  retryEventId: string | null;
  url: string;
  encryptedSecret: string;
  /** `event_id` of the body and header (none for a digest). */
  eventId: string | null;
  wireName: string;
  to: string;
  message: Readonly<Record<string, unknown>>;
  attempts: number;
  /** The data of an A6 notice, whose state goes back to `ai_lead_notices`. */
  leadNotice: Readonly<Record<string, unknown>> | null;
}>;

export type WhatsAppOutcome = Readonly<{
  status: "sent" | "skipped" | "failed" | "done" | "sending" | "deferred";
  reason: string | null;
  attempts: number;
  send?: WhatsAppSend;
}>;

export type WhatsAppEvent = Readonly<{
  id: string;
  type: string;
  partnerId: string;
  subjectId: string | null;
  idempotencyKey: string;
  data: Readonly<Record<string, unknown>>;
}>;

type Deps = Readonly<{
  fetch?: ChannelFetch;
  now?: () => Date;
  whatsapp?: WhatsAppMode;
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
  row: DeliveryRow,
  status: "skipped",
  reason: string | null,
): Promise<WhatsAppOutcome> {
  await tx.$executeRaw`
    update public.notification_deliveries
    set status = ${status}, reason = ${reason}, provider = null
    where id = ${row.id}::uuid
  `;
  return { status, reason, attempts: row.attempts };
}

/** The partner's webhook of an event, when it has one switched on. */
export async function eventWebhook(
  tx: ContextTransaction,
  eventId: string,
): Promise<{ url: string; encrypted_secret: string } | null> {
  const [webhook] = await tx.$queryRaw<
    { url: string; encrypted_secret: string }[]
  >`select url, encrypted_secret from private.event_notice_webhook(${eventId}::uuid)`;
  return webhook ?? null;
}

/**
 * Step 1: the delivery rows become `sending` with one more attempt; only
 * rows still waiting are claimed, so two runs never claim the same row.
 * Returns the attempts after the claim, or null when nothing was claimed.
 */
export async function claimDeliveries(
  tx: ContextTransaction,
  ids: readonly string[],
): Promise<number | null> {
  const rows = await tx.$queryRaw<{ attempts: number }[]>`
    update public.notification_deliveries
    set status = 'sending', sending_at = now(), attempts = attempts + 1,
        provider = 'partner_webhook', reason = null
    where id = any(${[...ids]}::uuid[])
      and status in ('pending', 'queued', 'failed')
    returning attempts
  `;
  if (rows.length === 0) return null;
  return Math.max(...rows.map((row) => Number(row.attempts)));
}

/** A follow-up `events.dispatch` run of the event. */
export async function scheduleDispatch(
  tx: ContextTransaction,
  eventId: string,
  key: string,
  delaySeconds: number,
): Promise<void> {
  await tx.$executeRaw`
    insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts, run_after)
    values (${EVENTS_DISPATCH_JOB_KIND}, 'platform', ${JSON.stringify({ eventId })}::jsonb,
            ${key.slice(0, 200)}, 3, now() + make_interval(secs => ${delaySeconds}))
    on conflict (kind, idempotency_key) do nothing
  `;
}

/** Claims a delivery of an event, or leaves it pending (`defer`). */
async function claimOrDefer(
  tx: ContextTransaction,
  args: Readonly<{
    row: DeliveryRow;
    event: WhatsAppEvent;
    wireName: string;
    to: string;
    message: Readonly<Record<string, unknown>>;
  }>,
  deps: Deps,
): Promise<WhatsAppOutcome> {
  const { row, event } = args;
  const webhook = await eventWebhook(tx, event.id);
  if (!webhook) return finishRow(tx, row, "skipped", "no_webhook");
  if ((deps.whatsapp ?? "defer") === "defer") {
    await scheduleDispatch(tx, event.id, `event:${event.id}:whatsapp`, 0);
    return { status: "deferred", reason: null, attempts: row.attempts };
  }
  const attempts = await claimDeliveries(tx, [row.id]);
  if (attempts === null) {
    return { status: "done", reason: null, attempts: row.attempts };
  }
  return {
    status: "sending",
    reason: null,
    attempts,
    send: {
      deliveryId: row.id,
      deliveryIds: [row.id],
      retryEventId: event.id,
      url: webhook.url,
      encryptedSecret: webhook.encrypted_secret,
      eventId: event.id,
      wireName: args.wireName,
      to: args.to,
      message: args.message,
      attempts,
      leadNotice: LEAD_NOTICE_EVENT_TYPES.has(event.type) ? event.data : null,
    },
  };
}

/**
 * Step 2: the signed POST (A6 format), with no transaction open. The
 * failure reason, or null when delivered.
 */
export async function postWhatsApp(
  send: WhatsAppSend,
  deps: Readonly<{ fetch?: ChannelFetch; now?: () => Date }> = {},
): Promise<string | null> {
  const now = deps.now ?? (() => new Date());
  const sentAt = now();
  const timestamp = String(Math.floor(sentAt.getTime() / 1000));
  const body = JSON.stringify({
    ...send.message,
    event: send.wireName,
    ...(send.eventId ? { event_id: send.eventId } : {}),
    to: send.to,
    sent_at: sentAt.toISOString(),
  });
  try {
    await providerJson(
      send.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-guidu-event": send.wireName,
          ...(send.eventId ? { "x-guidu-event-id": send.eventId } : {}),
          "x-guidu-delivery-id": send.deliveryId,
          "x-guidu-timestamp": timestamp,
          "x-guidu-signature": signWebhookBody(
            decryptSecret(send.encryptedSecret),
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
      return failureReason(error);
    }
  }
  return null;
}

/**
 * Step 3: the result of the POST, in a transaction of its own. Only rows
 * still `sending` change (the tick may have taken them back meanwhile).
 */
export async function recordWhatsAppResult(
  tx: ContextTransaction,
  send: WhatsAppSend,
  failure: string | null,
  deps: Readonly<{ now?: () => Date }> = {},
): Promise<WhatsAppOutcome> {
  const now = deps.now ?? (() => new Date());
  const status = failure ? "failed" : "sent";
  await tx.$executeRaw`
    update public.notification_deliveries
    set status = ${status}, reason = ${failure}, provider = 'partner_webhook'
    where id = any(${[...send.deliveryIds]}::uuid[]) and status = 'sending'
  `;
  if (failure && send.retryEventId && send.attempts < WHATSAPP_MAX_ATTEMPTS) {
    // A follow-up run tries again; the panel shows the failure meanwhile.
    await scheduleDispatch(
      tx,
      send.retryEventId,
      `event:${send.retryEventId}:retry:${send.attempts}`,
      RETRY_DELAY_SECONDS * send.attempts,
    );
  }
  if (send.leadNotice) {
    await recordLeadNoticeOutcome(tx, send.leadNotice, {
      status,
      reason: failure,
      attempts: send.attempts,
      at: now(),
    });
  }
  return { status, reason: failure, attempts: send.attempts };
}

/** Steps 2 and 3 for every claimed delivery, each result on its own. */
export async function sendClaimedWhatsApp(
  transaction: <T>(
    operation: (tx: ContextTransaction) => Promise<T>,
  ) => Promise<T>,
  sends: readonly WhatsAppSend[],
  deps: Readonly<{ fetch?: ChannelFetch; now?: () => Date }> = {},
): Promise<WhatsAppOutcome[]> {
  const outcomes: WhatsAppOutcome[] = [];
  for (const send of sends) {
    const failure = await postWhatsApp(send, deps);
    outcomes.push(
      await transaction((tx) => recordWhatsAppResult(tx, send, failure, deps)),
    );
  }
  return outcomes;
}

export async function deliverWhatsApp(
  tx: ContextTransaction,
  event: WhatsAppEvent,
  deps: Deps = {},
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
  if (!target) return finishRow(tx, row, "skipped", "no_target");
  if (target.skip) return finishRow(tx, row, "skipped", target.skip);
  if (!target.to) return finishRow(tx, row, "skipped", "no_recipient");

  return claimOrDefer(
    tx,
    {
      row,
      event,
      wireName: target.name ?? event.type,
      to: target.to,
      message: target.message,
    },
    deps,
  );
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
  send?: WhatsAppSend;
}>;

/**
 * The WhatsApp of one person (H2): skipped without an accepted number,
 * held (queued) inside the quiet window or for the digest, else claimed
 * for the partner's webhook with `event` = the catalog type and the
 * rendered `text`. Each person has one delivery per event; a failure
 * comes back with the event's follow-up run.
 */
export async function deliverPersonWhatsApp(
  tx: ContextTransaction,
  args: PersonWhatsApp,
  deps: Deps = {},
): Promise<PersonWhatsAppOutcome> {
  const now = deps.now ?? (() => new Date());
  const { event } = args;
  const key = `${event.idempotencyKey}:whatsapp:user:${args.userId}`.slice(
    0,
    200,
  );
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
  if (row.attempts >= WHATSAPP_MAX_ATTEMPTS)
    return { status: "done", reason: null };
  if (row.status === "queued" && row.hold_reason) {
    if (row.deliver_after && row.deliver_after.getTime() > now().getTime()) {
      return { status: "held", reason: row.hold_reason };
    }
  }
  if (!args.phone) {
    return finishRow(tx, row, "skipped", "no_whatsapp_consent");
  }
  if (args.hold && row.status === "pending") {
    await tx.$executeRaw`
      update public.notification_deliveries
      set status = 'queued', hold_reason = ${args.hold.reason},
          deliver_after = ${args.hold.until}, reason = ${args.hold.reason}
      where id = ${row.id}::uuid
    `;
    return { status: "held", reason: args.hold.reason };
  }
  return claimOrDefer(
    tx,
    {
      row,
      event,
      wireName: event.type,
      to: args.phone,
      message: { text: args.text },
    },
    deps,
  );
}
