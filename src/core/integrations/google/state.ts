import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  decryptSecret,
  encryptSecret,
  getMasterKeyConfig,
} from "@/core/credentials/crypto";

/**
 * The state and PKCE of the Google connection (CF6b):
 *
 * - the `state` sent to Google is signed (HMAC-SHA256 with a key derived
 *   from ENCRYPTION_KEY) and says who started, for which workspace, with
 *   which app, where to come back (the host where the person started) and
 *   until when (10 minutes). Google returns to one fixed URL (APP_URL), so
 *   the callback trusts only the signed origin, never a parameter;
 * - the PKCE verifier and a nonce live in an encrypted, httpOnly cookie of
 *   the host where the person started. The flow ends there, under the
 *   person's own session: the nonce must match the state and the session
 *   must be the one that started, so a link from someone else cannot
 *   attach their Google account to another workspace (CSRF).
 */

export const GOOGLE_STATE_TTL_MS = 10 * 60_000;
export const GOOGLE_FLOW_COOKIE = "guidu_google_oauth";

export type GoogleFlowState = Readonly<{
  workspaceId: string;
  organizationId: string;
  userId: string;
  workspaceSlug: string;
  /** Origin where the person started, where the flow ends. */
  returnOrigin: string;
  /** App used to start (its id); the exchange must use the same one. */
  appId: string;
  nonce: string;
  expiresAt: number;
}>;

type Packed = {
  w: string;
  o: string;
  u: string;
  s: string;
  r: string;
  a: string;
  n: string;
  e: number;
};

function stateKey(): Buffer {
  const { key } = getMasterKeyConfig();
  return Buffer.from(
    hkdfSync("sha256", key, "guidu", "google-oauth-state", 32),
  );
}

function sign(payload: string): string {
  return createHmac("sha256", stateKey()).update(payload).digest("base64url");
}

export function signGoogleState(state: GoogleFlowState): string {
  const packed: Packed = {
    w: state.workspaceId,
    o: state.organizationId,
    u: state.userId,
    s: state.workspaceSlug,
    r: state.returnOrigin,
    a: state.appId,
    n: state.nonce,
    e: state.expiresAt,
  };
  const payload = Buffer.from(JSON.stringify(packed)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The state when its signature holds and it has not expired; else null. */
export function verifyGoogleState(
  value: string | null | undefined,
  now: number = Date.now(),
): GoogleFlowState | null {
  if (!value || value.length > 2048) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  let packed: Partial<Packed>;
  try {
    packed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const strings = [
    packed.w,
    packed.o,
    packed.u,
    packed.s,
    packed.r,
    packed.a,
    packed.n,
  ];
  if (strings.some((v) => typeof v !== "string" || !v)) return null;
  if (typeof packed.e !== "number" || packed.e <= now) return null;
  return {
    workspaceId: packed.w!,
    organizationId: packed.o!,
    userId: packed.u!,
    workspaceSlug: packed.s!,
    returnOrigin: packed.r!,
    appId: packed.a!,
    nonce: packed.n!,
    expiresAt: packed.e,
  };
}

export type PkcePair = Readonly<{ verifier: string; challenge: string }>;

export function createPkce(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createNonce(): string {
  return randomBytes(16).toString("base64url");
}

/** Cookie value: nonce and verifier, encrypted (AES-256-GCM). */
export function sealFlowCookie(nonce: string, verifier: string): string {
  const { encryptedPayload } = encryptSecret(
    JSON.stringify({ n: nonce, v: verifier }),
  );
  return Buffer.from(encryptedPayload).toString("base64url");
}

export function openFlowCookie(
  value: string | null | undefined,
): { nonce: string; verifier: string } | null {
  if (!value || value.length > 4096) return null;
  try {
    const parsed = JSON.parse(
      decryptSecret(Buffer.from(value, "base64url").toString("utf8")),
    ) as { n?: unknown; v?: unknown };
    return typeof parsed.n === "string" && typeof parsed.v === "string"
      ? { nonce: parsed.n, verifier: parsed.v }
      : null;
  } catch {
    return null;
  }
}

/** Constant-time comparison of two short strings. */
export function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
