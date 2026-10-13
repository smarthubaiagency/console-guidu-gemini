import { NextResponse } from "next/server";

import { receiveChannelWebhook } from "@/core/channels/webhook";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

/**
 * Webhook of a channel connection (A5a, ADR 0011): the provider posts its
 * events here; the core checks the token of the URL, writes the normalized
 * events and answers at once. Nothing else is said back to the caller.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string; token: string }> },
) {
  const { connectionId, token } = await params;
  try {
    const result = await receiveChannelWebhook(
      prisma,
      request,
      connectionId,
      token,
    );
    return NextResponse.json(
      { ok: result.status === 200 },
      { status: result.status, headers: NO_STORE },
    );
  } catch (error) {
    appLog.error("channels.webhook.failed", { connectionId, error });
    // The provider retries; the event's id keeps the retry from doubling it.
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
