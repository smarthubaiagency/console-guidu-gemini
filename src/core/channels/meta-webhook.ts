import "server-only";

import type { PrismaClient } from "@prisma/client";

import { appLog } from "@/lib/telemetry/log";

import { MAX_WEBHOOK_BYTES } from "./contract";
import { ChannelHttpError, readLimited } from "./http";
import { metaApp, normalizeMeta, verifyMetaSignature } from "./meta";

/**
 * Webhook of the GUIDU app on Meta (IN7a): one address for every number.
 *
 * - `GET` answers the challenge of the webhook's registration when the
 *   verify token matches the platform's;
 * - `POST` checks the app secret's signature on the raw body, groups the
 *   events by number and writes them through `private.channel_meta_ingest`,
 *   which finds the connection by the number. Unknown numbers write
 *   nothing; Meta still gets a 200, so it does not retry what has no owner.
 */

export type MetaChallengeResult = Readonly<{
  status: 200 | 403 | 404;
  body: string;
}>;

export function answerMetaChallenge(url: URL): MetaChallengeResult {
  const { verifyToken } = metaApp();
  if (!verifyToken) return { status: 404, body: "" };
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || token !== verifyToken || challenge.length > 200) {
    return { status: 403, body: "" };
  }
  return { status: 200, body: challenge };
}

export type MetaWebhookResult = Readonly<{
  status: 200 | 400 | 401 | 404 | 413;
  stored?: number;
  duplicates?: number;
}>;

export async function receiveMetaWebhook(
  prisma: PrismaClient,
  request: Request,
): Promise<MetaWebhookResult> {
  const { appSecret } = metaApp();
  if (!appSecret) return { status: 404 };
  let raw: string;
  try {
    raw = await readLimited(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof ChannelHttpError && error.code === "too_large") {
      return { status: 413 };
    }
    throw error;
  }
  if (
    !verifyMetaSignature(
      raw,
      request.headers.get("x-hub-signature-256"),
      appSecret,
    )
  ) {
    return { status: 401 };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400 };
  }
  let stored = 0;
  let duplicates = 0;
  for (const batch of normalizeMeta(body)) {
    if (batch.events.length === 0 && batch.statuses.length === 0) continue;
    const rows = await prisma.$queryRaw<
      { stored: number; duplicates: number }[]
    >`
      select * from private.channel_meta_ingest(
        ${batch.phoneNumberId}, ${JSON.stringify(batch.events)}::jsonb,
        ${JSON.stringify(batch.statuses)}::jsonb
      )
    `;
    stored += rows[0]?.stored ?? 0;
    duplicates += rows[0]?.duplicates ?? 0;
  }
  appLog.info("channels.meta.webhook.received", { stored, duplicates });
  return { status: 200, stored, duplicates };
}
