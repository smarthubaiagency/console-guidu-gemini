import { NextResponse } from "next/server";

import {
  answerMetaChallenge,
  receiveMetaWebhook,
} from "@/core/channels/meta-webhook";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

/**
 * Webhook of the GUIDU app on Meta (IN7a): every WhatsApp number of the
 * app posts here. The core checks the signature, writes the normalized
 * events and answers at once.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export function GET(request: Request) {
  const result = answerMetaChallenge(new URL(request.url));
  return new NextResponse(result.body, {
    status: result.status,
    headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  try {
    const result = await receiveMetaWebhook(prisma, request);
    return NextResponse.json(
      { ok: result.status === 200 },
      { status: result.status, headers: NO_STORE },
    );
  } catch (error) {
    appLog.error("channels.meta.webhook.failed", { error });
    // Meta retries; the message's id keeps the retry from doubling it.
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
