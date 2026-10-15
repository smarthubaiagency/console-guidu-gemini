import { NextResponse } from "next/server";

import { receiveStripeWebhook } from "@/core/billing/gateway/webhook";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

/**
 * Webhook of Stripe Connect (CF7): the signature, the storage of the raw
 * body and the idempotency live in `receiveStripeWebhook`. No session and
 * no cookie: the signature is the only credential.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  try {
    const result = await receiveStripeWebhook(prisma, request);
    return NextResponse.json(result.body, {
      status: result.status,
      headers: NO_STORE,
    });
  } catch (error) {
    appLog.error("billing.stripe_webhook.failed", { error });
    // Stripe retries; the event id keeps the retry from doubling it.
    return NextResponse.json(
      { error: "Internal error." },
      { status: 500, headers: NO_STORE },
    );
  }
}
