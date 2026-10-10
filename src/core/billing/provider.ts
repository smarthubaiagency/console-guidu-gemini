import { AppError } from "@/shared/errors";

/**
 * Payment provider port (especificação de parceiros §3.3). The billing domain
 * only knows `ProviderEvent`; each adapter turns its own API and webhooks
 * into these events. Iugu and Stripe are planned and switched off until P6;
 * the manual adapter records payments received outside the platform.
 */

export const PROVIDER_KEYS = ["manual", "iugu", "stripe"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export const CHECKOUT_METHODS = ["card", "pix", "boleto"] as const;
export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];

/** How a payment was made; manual records also accept transfers. */
export const PAYMENT_METHODS = [
  "pix",
  "boleto",
  "transfer",
  "card",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ProviderCapabilities = Readonly<{
  split: boolean;
  recurring: boolean;
  methods: readonly CheckoutMethod[];
  hostedCheckout: boolean;
  /** KYC of the partner's receiving account at the provider. */
  recipientOnboarding: boolean;
}>;

export type PartnerRef = Readonly<{ kind: "partner"; id: string }>;
export type OrganizationRef = Readonly<{ kind: "organization"; id: string }>;
export type RecipientRef = Readonly<{
  provider: ProviderKey;
  externalId: string;
}>;
export type CustomerRef = RecipientRef;
export type SubscriptionRef = RecipientRef;
export type PaymentRef = RecipientRef;
export type RecipientStatus =
  "pending" | "verified" | "rejected" | "not_required";

export type CheckoutInput = Readonly<{
  mode: "customer_pays" | "partner_pays";
  payer: PartnerRef | OrganizationRef;
  amountCents: number;
  /** Division at the source; only in `customer_pays`. */
  split: Readonly<{
    recipient: RecipientRef;
    partnerShareCents: number;
  }> | null;
  description: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}>;

export const PROVIDER_EVENT_TYPES = [
  "recipient.verified",
  "recipient.rejected",
  "payment.paid",
  "payment.failed",
  "payment.refunded",
  "chargeback.opened",
  "chargeback.closed",
  "subscription.canceled",
] as const;
export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number];

export type PaymentEvidence = Readonly<{
  bytes: Uint8Array;
  mime: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
}>;

type EventBase = Readonly<{
  provider: ProviderKey;
  /** Unique per provider; the idempotency key of the event. */
  externalId: string;
  partnerId: string;
  occurredAt: Date;
}>;

export type PaymentPaidEvent = EventBase &
  Readonly<{
    type: "payment.paid";
    data: Readonly<{
      subscriptionId: string;
      amountCents: number;
      method: PaymentMethod;
      paidOn: Date;
      note: string | null;
      /** Kept in the payment row, never in the event payload. */
      evidence: PaymentEvidence | null;
    }>;
  }>;

export type PaymentRefundedEvent = EventBase &
  Readonly<{
    type: "payment.refunded";
    data: Readonly<{
      paymentId: string;
      refundedOn: Date;
      reason: string | null;
    }>;
  }>;

export type OtherProviderEvent = EventBase &
  Readonly<{
    type: Exclude<ProviderEventType, "payment.paid" | "payment.refunded">;
    data: Readonly<Record<string, string | number | boolean | null>>;
  }>;

export type ProviderEvent =
  PaymentPaidEvent | PaymentRefundedEvent | OtherProviderEvent;

export interface PaymentProvider {
  readonly key: ProviderKey;
  readonly capabilities: ProviderCapabilities;
  createRecipient(partner: PartnerRef): Promise<RecipientRef>;
  getRecipientStatus(ref: RecipientRef): Promise<RecipientStatus>;
  upsertCustomer(payer: OrganizationRef | PartnerRef): Promise<CustomerRef>;
  createCheckout(
    input: CheckoutInput,
  ): Promise<{ url: string; externalId: string }>;
  cancelSubscription(ref: SubscriptionRef): Promise<void>;
  refund(ref: PaymentRef, amountCents: number): Promise<void>;
  verifyWebhook(raw: Uint8Array, headers: Headers): Promise<ProviderEvent[]>;
}

export class ProviderNotConfiguredError extends AppError {
  readonly provider: ProviderKey;
  constructor(provider: ProviderKey) {
    super({
      code: "unavailable",
      safeMessage: "Provedor de pagamento não configurado.",
    });
    this.name = "ProviderNotConfiguredError";
    this.provider = provider;
  }
}

export class ProviderUnsupportedError extends AppError {
  readonly provider: ProviderKey;
  constructor(provider: ProviderKey, operation: string) {
    super({
      code: "invalid_input",
      safeMessage: "Operação não disponível para este provedor de pagamento.",
    });
    this.name = "ProviderUnsupportedError";
    this.provider = provider;
    this.message = `${provider}: ${operation} is not supported`;
  }
}

export function isProviderKey(value: string): value is ProviderKey {
  return (PROVIDER_KEYS as readonly string[]).includes(value);
}
