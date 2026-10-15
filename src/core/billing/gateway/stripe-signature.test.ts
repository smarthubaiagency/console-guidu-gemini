import { describe, expect, it } from "vitest";

import {
  computeSignature,
  parseSignatureHeader,
  signStripePayload,
  verifyStripeSignature,
} from "./stripe-signature";

const SECRET = "whsec_test_0123456789abcdefABCDEF";
const BODY = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
const NOW = new Date("2026-10-15T12:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);

describe("Stripe webhook signature (CF7)", () => {
  it("accepts a valid signature over the raw bytes", () => {
    const header = signStripePayload(BODY, SECRET, T);
    expect(
      verifyStripeSignature({
        payload: BODY,
        header,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: true, timestamp: T });
    expect(
      verifyStripeSignature({
        payload: Buffer.from(BODY, "utf8"),
        header,
        secret: SECRET,
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("matches the documented scheme: HMAC-SHA256 of `t.body`, hex", () => {
    // printf '1700000000.{}' | openssl dgst -sha256 -hmac whsec_abc
    expect(computeSignature("{}", "whsec_abc", 1_700_000_000)).toBe(
      "bad9ac117e973d721c232d46744158d75e3f1b44e36771e13d01b9e6a580bc72",
    );
  });

  it("refuses a wrong secret, a changed body and a forged signature", () => {
    const header = signStripePayload(BODY, SECRET, T);
    expect(
      verifyStripeSignature({
        payload: BODY,
        header,
        secret: "whsec_other_secret_value",
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
    expect(
      verifyStripeSignature({
        payload: `${BODY} `,
        header,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: `t=${T},v1=${"0".repeat(64)}`,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses a signature outside the 5-minute tolerance, past or future", () => {
    const old = signStripePayload(BODY, SECRET, T - 301);
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: old,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "expired" });
    const future = signStripePayload(BODY, SECRET, T + 301);
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: future,
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "expired" });
    const edge = signStripePayload(BODY, SECRET, T - 300);
    expect(
      verifyStripeSignature({
        payload: BODY,
        header: edge,
        secret: SECRET,
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("refuses a missing or malformed header", () => {
    expect(
      verifyStripeSignature({ payload: BODY, header: null, secret: SECRET }),
    ).toEqual({ ok: false, reason: "missing_header" });
    for (const header of [
      "",
      "garbage",
      `t=${T}`,
      `v1=${"a".repeat(64)}`,
      `t=abc,v1=${"a".repeat(64)}`,
      `t=${T},v1=xyz`,
      `t=${T},v0=${"a".repeat(64)}`,
    ]) {
      const result = verifyStripeSignature({
        payload: BODY,
        header,
        secret: SECRET,
        now: NOW,
      });
      expect(result.ok, header).toBe(false);
    }
  });

  it("accepts any of several v1 signatures (secret rotation)", () => {
    const good = computeSignature(BODY, SECRET, T);
    const header = `t=${T},v1=${"b".repeat(64)},v1=${good},v0=${"c".repeat(64)}`;
    expect(parseSignatureHeader(header)?.signatures).toHaveLength(2);
    expect(
      verifyStripeSignature({ payload: BODY, header, secret: SECRET, now: NOW })
        .ok,
    ).toBe(true);
  });
});
