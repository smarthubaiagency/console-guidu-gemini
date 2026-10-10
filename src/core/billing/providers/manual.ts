import {
  type PaymentEvidence,
  type PaymentMethod,
  type PaymentPaidEvent,
  type PaymentProvider,
  type PaymentRefundedEvent,
  ProviderUnsupportedError,
} from "../provider";

/**
 * Manual adapter (especificação de parceiros §3.4): no gateway. A payment
 * received outside the platform (transfer, Pix, own boleto) is recorded with
 * evidence and becomes a `payment.paid` event keyed by the idempotency key
 * of the form, so a double submit has no second effect. It has no division,
 * so it never serves the customer pays checkout.
 */

export type ManualPaymentInput = Readonly<{
  partnerId: string;
  subscriptionId: string;
  amountCents: number;
  method: PaymentMethod;
  paidOn: Date;
  note: string | null;
  evidence: PaymentEvidence;
  idempotencyKey: string;
}>;

export type ManualRefundInput = Readonly<{
  partnerId: string;
  paymentId: string;
  reason: string | null;
  refundedOn: Date;
}>;

export type ManualProvider = PaymentProvider &
  Readonly<{
    paymentEvent(input: ManualPaymentInput): PaymentPaidEvent;
    refundEvent(input: ManualRefundInput): PaymentRefundedEvent;
  }>;

export const manualProvider: ManualProvider = {
  key: "manual",
  capabilities: {
    split: false,
    recurring: false,
    methods: ["pix", "boleto"],
    hostedCheckout: false,
    recipientOnboarding: false,
  },
  async createRecipient(partner) {
    return { provider: "manual", externalId: `partner:${partner.id}` };
  },
  async getRecipientStatus() {
    return "not_required";
  },
  async upsertCustomer(payer) {
    return { provider: "manual", externalId: `${payer.kind}:${payer.id}` };
  },
  async createCheckout() {
    throw new ProviderUnsupportedError("manual", "createCheckout");
  },
  // Nothing to cancel or refund remotely: the domain records the change.
  async cancelSubscription() {},
  async refund(_ref, amountCents) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new ProviderUnsupportedError("manual", "refund of invalid amount");
    }
  },
  async verifyWebhook() {
    throw new ProviderUnsupportedError("manual", "verifyWebhook");
  },
  paymentEvent(input) {
    return {
      type: "payment.paid",
      provider: "manual",
      externalId: `payment:${input.idempotencyKey}`,
      partnerId: input.partnerId,
      occurredAt: new Date(),
      data: {
        subscriptionId: input.subscriptionId,
        amountCents: input.amountCents,
        method: input.method,
        paidOn: input.paidOn,
        note: input.note,
        evidence: input.evidence,
      },
    };
  },
  refundEvent(input) {
    return {
      type: "payment.refunded",
      provider: "manual",
      // One refund per payment.
      externalId: `refund:${input.paymentId}`,
      partnerId: input.partnerId,
      occurredAt: new Date(),
      data: {
        paymentId: input.paymentId,
        refundedOn: input.refundedOn,
        reason: input.reason,
      },
    };
  },
};
