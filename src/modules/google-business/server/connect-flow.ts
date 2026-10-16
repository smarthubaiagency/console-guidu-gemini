import { randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { decryptSecret, encryptSecret } from "@/core/credentials/crypto";

import { type GbTarget, GbTargetSchema } from "./target";

/**
 * State of the Google connection of the onboarding (GB1a), in an
 * encrypted, httpOnly cookie of the host where the person started: who
 * started, for which target, a nonce that must come back as `state` in the
 * return URL (CSRF), and, after the consent, the provider's pending data
 * (never shown, never in the URL). It lives 30 minutes.
 */

export const GB_CONNECT_COOKIE = "guidu_gb_connect";
export const GB_CONNECT_TTL_MS = 30 * 60_000;
export const GB_CALLBACK_PATH = "/auth/google-business/callback";

const Flow = z.object({
  u: z.uuid(),
  t: GbTargetSchema,
  n: z.string().min(16).max(64),
  e: z.number().int(),
  p: z.string().max(4096).optional(),
});

export type ConnectFlow = Readonly<{
  userId: string;
  target: GbTarget;
  nonce: string;
  expiresAt: number;
  pending?: string;
}>;

export function newConnectFlow(
  userId: string,
  target: GbTarget,
  now: number = Date.now(),
): ConnectFlow {
  return {
    userId,
    target,
    nonce: randomBytes(16).toString("base64url"),
    expiresAt: now + GB_CONNECT_TTL_MS,
  };
}

export function sealConnectFlow(flow: ConnectFlow): string {
  const packed: z.input<typeof Flow> = {
    u: flow.userId,
    t: flow.target,
    n: flow.nonce,
    e: flow.expiresAt,
    ...(flow.pending ? { p: flow.pending } : {}),
  };
  return Buffer.from(
    encryptSecret(JSON.stringify(packed)).encryptedPayload,
  ).toString("base64url");
}

export function openConnectFlow(
  value: string | null | undefined,
  now: number = Date.now(),
): ConnectFlow | null {
  if (!value || value.length > 12_000) return null;
  try {
    const parsed = Flow.safeParse(
      JSON.parse(
        decryptSecret(Buffer.from(value, "base64url").toString("utf8")),
      ),
    );
    if (!parsed.success || parsed.data.e <= now) return null;
    return {
      userId: parsed.data.u,
      target: parsed.data.t,
      nonce: parsed.data.n,
      expiresAt: parsed.data.e,
      ...(parsed.data.p ? { pending: parsed.data.p } : {}),
    };
  } catch {
    return null;
  }
}

export function sameNonce(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sameTarget(a: GbTarget, b: GbTarget): boolean {
  return a.scope === "app"
    ? b.scope === "app" && a.workspaceSlug === b.workspaceSlug
    : b.scope === "admin" && a.workspaceId === b.workspaceId;
}

/** The return URL given to the provider (same host, with the nonce). */
export function callbackUrl(origin: string, nonce: string): string {
  const url = new URL(GB_CALLBACK_PATH, origin);
  url.searchParams.set("state", nonce);
  return url.toString();
}
