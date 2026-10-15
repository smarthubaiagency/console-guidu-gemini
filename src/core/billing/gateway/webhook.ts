import "server-only";

import { ChannelHttpError, readLimitedBytes } from "@/core/channels/http";
import { decryptSecret } from "@/core/credentials/crypto";
import type { SqlExecutor } from "@/core/i18n/messages-loader";
import { appLog } from "@/lib/telemetry/log";

import {
  type GatewayMode,
  isGatewayMode,
  MAX_STRIPE_WEBHOOK_BYTES,
  parseStripeEvent,
  processStripeEvent,
  TEST_EVENT_TYPE,
} from "./stripe";
import {
  STRIPE_SIGNATURE_HEADER,
  verifyStripeSignature,
} from "./stripe-signature";

/**
 * Webhook of Stripe (CF7). Without identity, it goes through three security
 * definer functions (migration 20261122090000):
 *
 * 1. the encrypted signing secret of the enabled gateway (none: 404);
 * 2. the signature over the raw bytes (`Stripe-Signature`, 5 minutes of
 *    tolerance, constant-time comparison): a call that fails it is never
 *    stored (400);
 * 3. the raw body is stored once per event id; a repeated delivery of an
 *    event already processed answers 200 with no second effect, and one
 *    that failed is processed again;
 * 4. processing only records the event in this step (D-PA-14): no
 *    subscription changes. A failure (an event of the other mode) is kept
 *    as `failed`, still answered 200 so Stripe does not retry for days;
 *    the platform reprocesses it from Cobrança › Gateway.
 *
 * Answers carry English messages only (API errors, I2).
 */

export type StripeWebhookResult = Readonly<{
  status: 200 | 400 | 404 | 413 | 500;
  body: Readonly<Record<string, unknown>>;
}>;

type SecretRow = { mode: string; webhook_secret_encrypted: string };
type StoredRow = { id: string; status: string; inserted: boolean };

export async function receiveStripeWebhook(
  db: SqlExecutor,
  request: Request,
  now: Date = new Date(),
): Promise<StripeWebhookResult> {
  const rows = await db.$queryRaw<SecretRow[]>`
    select mode, webhook_secret_encrypted
    from private.payment_webhook_secret('stripe')
  `;
  const gateway = rows[0];
  if (!gateway || !isGatewayMode(gateway.mode)) {
    await request.body?.cancel().catch(() => undefined);
    return { status: 404, body: { error: "Webhook not configured." } };
  }

  let raw: Buffer;
  try {
    raw = await readLimitedBytes(request, MAX_STRIPE_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof ChannelHttpError && error.code === "too_large") {
      return { status: 413, body: { error: "Payload too large." } };
    }
    throw error;
  }

  let secret: string;
  try {
    secret = decryptSecret(gateway.webhook_secret_encrypted);
  } catch {
    appLog.error("billing.stripe_webhook.secret_unavailable");
    return { status: 500, body: { error: "Webhook secret unavailable." } };
  }

  const check = verifyStripeSignature({
    payload: raw,
    header: request.headers.get(STRIPE_SIGNATURE_HEADER),
    secret,
    now,
  });
  if (!check.ok) {
    appLog.warn("billing.stripe_webhook.rejected", { reason: check.reason });
    return { status: 400, body: { error: "Invalid signature." } };
  }

  const text = raw.toString("utf8");
  const event = parseStripeEvent(text);
  if (!event) {
    return { status: 400, body: { error: "Invalid event." } };
  }

  const stored = (
    await db.$queryRaw<StoredRow[]>`
      select id, status, inserted
      from private.payment_webhook_receive(
        'stripe', ${event.id}, ${event.type}, ${event.livemode},
        ${event.type === TEST_EVENT_TYPE}, ${text}
      )
    `
  )[0];
  if (!stored) {
    return { status: 500, body: { error: "Event not stored." } };
  }
  if (!stored.inserted && stored.status === "processed") {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  const error = processStripeEvent(text, gateway.mode as GatewayMode);
  await db.$queryRaw`select private.payment_webhook_finish(${stored.id}::uuid, ${error}::text)`;
  appLog.info("billing.stripe_webhook.received", {
    type: event.type,
    duplicate: !stored.inserted,
    status: error ? "failed" : "processed",
  });
  return {
    status: 200,
    body: {
      received: true,
      duplicate: !stored.inserted,
      status: error ? "failed" : "processed",
    },
  };
}
