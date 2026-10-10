import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkEvent,
  checkProviderConformance,
  checkProviderNotConfigured,
} from "./conformance";
import { eventPayload } from "./events";
import { type PaymentProvider, ProviderUnsupportedError } from "./provider";
import { manualProvider } from "./providers/manual";
import { iuguProvider, stripeProvider } from "./providers/planned";
import { getProvider, isProviderEnabled, listProviders } from "./registry";

const evidence = {
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  mime: "application/pdf",
} as const;

function manualEvents() {
  return [
    manualProvider.paymentEvent({
      partnerId: "b0000000-0000-4000-8000-0000000000c1",
      subscriptionId: "f0000000-0000-4000-8000-0000000000c1",
      amountCents: 3_000,
      method: "pix",
      paidOn: new Date("2026-10-05T00:00:00Z"),
      note: null,
      evidence,
      idempotencyKey: "7d8a3a8e-5a1f-4f9c-9c1e-1d4f3c2b1a00",
    }),
    manualProvider.refundEvent({
      partnerId: "b0000000-0000-4000-8000-0000000000c1",
      paymentId: "f0000000-0000-4000-8000-0000000000c2",
      reason: "Comprovante inválido",
      refundedOn: new Date("2026-10-06T00:00:00Z"),
    }),
  ];
}

describe("provider conformance", () => {
  it("the manual adapter passes the suite", async () => {
    expect(
      await checkProviderConformance(manualProvider, {
        sampleEvents: manualEvents,
      }),
    ).toEqual([]);
  });

  it("the suite catches an adapter that pretends to do what it cannot", async () => {
    const broken: PaymentProvider = {
      ...manualProvider,
      createCheckout: async () => ({ url: "https://x.test", externalId: "x" }),
      refund: async () => {},
      verifyWebhook: async () => [manualEvents()[0]!],
    };
    const failures = await checkProviderConformance(broken);
    expect(failures).toEqual(
      expect.arrayContaining([
        "createCheckout must be refused without hosted checkout",
        "unsigned webhook produced events",
        "refund of 0 cents must be refused",
      ]),
    );
    expect(
      checkEvent(manualProvider, { ...manualEvents()[0]!, provider: "iugu" }),
    ).toEqual(["event of iugu produced by manual"]);
  });

  it.each([
    ["iugu", iuguProvider],
    ["stripe", stripeProvider],
  ])(
    "%s is planned and answers provedor não configurado",
    async (_name, provider) => {
      expect(await checkProviderNotConfigured(provider)).toEqual([]);
      expect(provider.capabilities.split).toBe(true);
    },
  );

  // P6: when a real adapter is turned on, it must pass the full suite.
  it.todo("iugu passes checkProviderConformance (P6)");
  it.todo("stripe passes checkProviderConformance (P6)");
});

describe("registry", () => {
  it("enables only the manual adapter in P5m", () => {
    expect(isProviderEnabled("manual")).toBe(true);
    expect(isProviderEnabled("iugu")).toBe(false);
    expect(isProviderEnabled("stripe")).toBe(false);
    expect(listProviders().map((p) => [p.provider.key, p.enabled])).toEqual([
      ["manual", true],
      ["iugu", false],
      ["stripe", false],
    ]);
    expect(getProvider("iugu")).toBe(iuguProvider);
  });
});

describe("manual adapter", () => {
  it("keys payment events by the form idempotency key and refunds by payment", () => {
    const [paid, refunded] = manualEvents();
    expect(paid!.externalId).toBe(
      "payment:7d8a3a8e-5a1f-4f9c-9c1e-1d4f3c2b1a00",
    );
    expect(refunded!.externalId).toBe(
      "refund:f0000000-0000-4000-8000-0000000000c2",
    );
  });

  it("never serves a checkout", async () => {
    await expect(
      manualProvider.createCheckout({
        mode: "partner_pays",
        payer: { kind: "partner", id: "p" },
        amountCents: 3_000,
        split: null,
        description: "x",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
        idempotencyKey: "k",
      }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });

  it("keeps the evidence out of the stored event payload", () => {
    const payload = eventPayload(manualEvents()[0]!);
    expect(payload).toEqual({
      subscriptionId: "f0000000-0000-4000-8000-0000000000c1",
      amountCents: 3_000,
      method: "pix",
      paidOn: "2026-10-05",
    });
  });
});
