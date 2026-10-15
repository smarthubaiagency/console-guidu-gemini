import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature of the Stripe webhooks (CF7), checked without the SDK. Stripe
 * sends `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>...]`, where
 * each `v1` is HMAC-SHA256 of `<t>.<raw body>` with the endpoint's signing
 * secret (`whsec_...`). A call is accepted when one `v1` matches, compared
 * in constant time, and `t` is within the tolerance (5 minutes, Stripe's
 * default), which stops replays of an old call.
 */

export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  "missing_header" | "malformed_header" | "expired" | "mismatch";

export type SignatureCheck =
  | Readonly<{ ok: true; timestamp: number }>
  | Readonly<{ ok: false; reason: SignatureFailure }>;

type Parsed = Readonly<{ timestamp: number; signatures: readonly string[] }>;

const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

/** `t` and every `v1` of the header; other schemes (`v0`) are ignored. */
export function parseSignatureHeader(header: string): Parsed | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1" && HEX_SIGNATURE.test(value)) {
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function payloadBuffer(payload: Uint8Array | string): Buffer {
  return typeof payload === "string"
    ? Buffer.from(payload, "utf8")
    : Buffer.from(payload);
}

/** HMAC-SHA256 hex of `<timestamp>.<payload>`. */
export function computeSignature(
  payload: Uint8Array | string,
  secret: string,
  timestamp: number,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.`, "utf8")
    .update(payloadBuffer(payload))
    .digest("hex");
}

/** A header like Stripe's, for the test webhook and the tests. */
export function signStripePayload(
  payload: Uint8Array | string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${computeSignature(payload, secret, timestamp)}`;
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyStripeSignature(
  input: Readonly<{
    payload: Uint8Array | string;
    header: string | null | undefined;
    secret: string;
    toleranceSeconds?: number;
    now?: Date;
  }>,
): SignatureCheck {
  if (!input.header) return { ok: false, reason: "missing_header" };
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) return { ok: false, reason: "malformed_header" };
  const expected = computeSignature(
    input.payload,
    input.secret,
    parsed.timestamp,
  );
  // Every candidate is compared, so the time does not tell which one matched.
  let matched = false;
  for (const signature of parsed.signatures) {
    if (sameHex(signature, expected)) matched = true;
  }
  if (!matched) return { ok: false, reason: "mismatch" };
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, timestamp: parsed.timestamp };
}
