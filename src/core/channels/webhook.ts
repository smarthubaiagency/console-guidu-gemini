import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { appLog } from "@/lib/telemetry/log";

import { normalizeChatwoot } from "./chatwoot";
import { CHANNEL_KINDS, type ChannelKind, MAX_WEBHOOK_BYTES } from "./contract";
import { ChannelHttpError, readLimited } from "./http";

/**
 * Entry of the channels (ADR 0011, decision 1; canais.md §4, step 1): the
 * webhook of a connection only checks its token, normalizes the events and
 * writes them with a unique external id. It never calls a consumer (the
 * dispatch is a job of the worker, from the A5b). Answers:
 *
 * - 200 when the events were written, or were already there;
 * - 404 for an unknown connection, a wrong token or a disabled connection,
 *   all alike, so the answer reveals nothing;
 * - 413 for a body over the limit, 400 for a body that is not JSON.
 *
 * The token travels in the URL (the Agent Bot does not sign its calls) and
 * is kept only as its SHA-256; the comparison happens in the database on
 * the hash, never on the token.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A new webhook token (shown once, in the URL) and its hash. */
export function newWebhookToken(): Readonly<{ token: string; hash: string }> {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashWebhookToken(token) };
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Path of a connection's webhook, under the public origin of the app. */
export function webhookPath(connectionId: string, token: string): string {
  return `/api/channels/${connectionId}/${token}`;
}

function normalize(kind: ChannelKind, body: unknown) {
  switch (kind) {
    case "chatwoot":
      return normalizeChatwoot(body);
  }
}

export type WebhookResult = Readonly<{
  status: 200 | 400 | 404 | 413;
  stored?: number;
  duplicates?: number;
}>;

export async function receiveChannelWebhook(
  prisma: PrismaClient,
  request: Request,
  connectionId: string,
  token: string,
): Promise<WebhookResult> {
  if (!UUID.test(connectionId) || !TOKEN.test(token)) return { status: 404 };
  const hash = hashWebhookToken(token);
  const found = await prisma.$queryRaw<{ kind: string | null }[]>`
    select private.channel_webhook_connection(${connectionId}::uuid, ${hash}) as kind
  `;
  const kind = found[0]?.kind;
  if (!kind || !(CHANNEL_KINDS as readonly string[]).includes(kind)) {
    return { status: 404 };
  }

  let raw: string;
  try {
    raw = await readLimited(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof ChannelHttpError && error.code === "too_large") {
      return { status: 413 };
    }
    throw error;
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400 };
  }

  const events = normalize(kind as ChannelKind, body);
  if (events.length === 0) return { status: 200, stored: 0, duplicates: 0 };
  const rows = await prisma.$queryRaw<{ stored: number; duplicates: number }[]>`
    select * from private.channel_ingest(
      ${connectionId}::uuid, ${hash}, ${JSON.stringify(events)}::jsonb
    )
  `;
  const row = rows[0];
  // Disabled between the two calls.
  if (!row) return { status: 404 };
  appLog.info("channels.webhook.received", {
    connectionId,
    kind,
    stored: row.stored,
    duplicates: row.duplicates,
  });
  return { status: 200, stored: row.stored, duplicates: row.duplicates };
}
