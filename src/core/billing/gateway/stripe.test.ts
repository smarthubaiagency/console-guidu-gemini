import { describe, expect, it } from "vitest";

import {
  buildTestEvent,
  checkSecretKey,
  checkWebhookSecret,
  maskStripeSecret,
  parseStripeEvent,
  processStripeEvent,
  secretKeyMode,
  TEST_EVENT_TYPE,
} from "./stripe";

const TEST_KEY = `sk_test_${"a1".repeat(12)}`;
const LIVE_KEY = `rk_live_${"b2".repeat(12)}`;

describe("Stripe credentials (CF7)", () => {
  it("checks the secret key format and its mode", () => {
    expect(checkSecretKey(TEST_KEY, "test")).toBeNull();
    expect(checkSecretKey(LIVE_KEY, "live")).toBeNull();
    expect(checkSecretKey(TEST_KEY, "live")).toBe("secretKeyMode");
    expect(checkSecretKey("pk_test_abcdefabcdefabcdef", "test")).toBe(
      "secretKeyFormat",
    );
    expect(checkSecretKey("sk_test_short", "test")).toBe("secretKeyFormat");
  });

  it("checks the webhook signing secret", () => {
    expect(checkWebhookSecret("whsec_abcdefghijklmnop1234")).toBeNull();
    expect(checkWebhookSecret("abcdefghijklmnop1234")).toBe(
      "webhookSecretFormat",
    );
  });

  it("masks keeping only the prefix and the last four characters", () => {
    expect(maskStripeSecret(TEST_KEY)).toBe("sk_test_...a1a1");
    expect(maskStripeSecret("whsec_abcdefghijklmnop1234")).toBe(
      "whsec_...1234",
    );
    expect(maskStripeSecret(TEST_KEY)).not.toContain("a1a1a1");
    expect(secretKeyMode(maskStripeSecret(LIVE_KEY))).toBe("live");
    expect(secretKeyMode(null)).toBeNull();
  });
});

describe("Stripe events (CF7)", () => {
  it("reads id, type and mode, and refuses anything else", () => {
    expect(
      parseStripeEvent(
        JSON.stringify({
          id: "evt_123",
          type: "invoice.paid",
          livemode: false,
        }),
      ),
    ).toEqual({ id: "evt_123", type: "invoice.paid", livemode: false });
    for (const raw of [
      "not json",
      "[]",
      JSON.stringify({ id: "123", type: "invoice.paid", livemode: false }),
      JSON.stringify({ id: "evt_1", type: "Invoice Paid", livemode: false }),
      JSON.stringify({ id: "evt_1", type: "invoice.paid" }),
    ]) {
      expect(parseStripeEvent(raw), raw).toBeNull();
    }
  });

  it("only records: an event of the other mode fails, nothing else does", () => {
    const testEvent = JSON.stringify({
      id: "evt_1",
      type: "invoice.paid",
      livemode: false,
    });
    expect(processStripeEvent(testEvent, "test")).toBeNull();
    expect(processStripeEvent(testEvent, "live")).toBe("mode_mismatch");
    expect(processStripeEvent("{}", "test")).toBe("invalid_event");
  });

  it("builds a test event with no data, in the gateway's mode", () => {
    const event = JSON.parse(buildTestEvent("live")) as Record<string, unknown>;
    expect(event.type).toBe(TEST_EVENT_TYPE);
    expect(event.livemode).toBe(true);
    expect(event.data).toEqual({ object: {} });
    expect(parseStripeEvent(buildTestEvent("test"))?.livemode).toBe(false);
    expect(buildTestEvent("test")).not.toBe(buildTestEvent("test"));
  });
});
