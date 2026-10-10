import {
  CHECKOUT_METHODS,
  type CheckoutInput,
  type PaymentProvider,
  PROVIDER_EVENT_TYPES,
  PROVIDER_KEYS,
  type ProviderEvent,
  ProviderNotConfiguredError,
  ProviderUnsupportedError,
} from "./provider";

/**
 * Conformance suite every payment adapter must pass (especificação de
 * parceiros §3.3, "suíte de conformidade comum"). It returns the failures
 * instead of asserting, so the same checks run for the manual adapter now
 * and for Iugu and Stripe when P6 turns them on.
 */

export type ConformanceOptions = Readonly<{
  /** Events the adapter produces from its own inputs (fixtures). */
  sampleEvents?: () => readonly ProviderEvent[];
}>;

const PARTNER = {
  kind: "partner",
  id: "b0000000-0000-4000-8000-0000000000c1",
} as const;

const CUSTOMER_PAYS_CHECKOUT: CheckoutInput = {
  mode: "customer_pays",
  payer: { kind: "organization", id: "a0000000-0000-4000-8000-0000000000c2" },
  amountCents: 10_000,
  split: {
    recipient: { provider: "manual", externalId: "recipient" },
    partnerShareCents: 7_000,
  },
  description: "Conformidade",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/cancel",
  idempotencyKey: "conformance-checkout",
};

async function rejectsWith(
  run: () => Promise<unknown>,
  ...errors: Array<abstract new (...args: never[]) => Error>
): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (error) {
    return errors.some((type) => error instanceof type);
  }
}

export function checkEvent(
  provider: PaymentProvider,
  event: ProviderEvent,
): string[] {
  const failures: string[] = [];
  if (!(PROVIDER_EVENT_TYPES as readonly string[]).includes(event.type)) {
    failures.push(`event type ${event.type} is not normalized`);
  }
  if (event.provider !== provider.key) {
    failures.push(`event of ${event.provider} produced by ${provider.key}`);
  }
  if (!event.externalId || event.externalId.length > 200) {
    failures.push("event external id must be 1–200 characters");
  }
  if (event.type === "payment.paid") {
    if (
      !Number.isSafeInteger(event.data.amountCents) ||
      event.data.amountCents <= 0
    ) {
      failures.push("payment amounts are positive integer cents");
    }
  }
  return failures;
}

/** Checks for an adapter that is switched on. */
export async function checkProviderConformance(
  provider: PaymentProvider,
  options: ConformanceOptions = {},
): Promise<string[]> {
  const failures: string[] = [];
  const { capabilities } = provider;

  if (!(PROVIDER_KEYS as readonly string[]).includes(provider.key)) {
    failures.push(`unknown provider key ${provider.key}`);
  }
  if (
    capabilities.methods.some(
      (method) => !(CHECKOUT_METHODS as readonly string[]).includes(method),
    )
  ) {
    failures.push("capabilities list an unknown checkout method");
  }
  if (capabilities.split && !capabilities.recipientOnboarding) {
    failures.push("split needs the partner's receiving account (KYC)");
  }

  // What the capabilities deny must fail loudly, never succeed silently.
  if (
    !capabilities.hostedCheckout &&
    !(await rejectsWith(
      () => provider.createCheckout(CUSTOMER_PAYS_CHECKOUT),
      ProviderUnsupportedError,
    ))
  ) {
    failures.push("createCheckout must be refused without hosted checkout");
  }
  if (
    !capabilities.split &&
    capabilities.hostedCheckout &&
    !(await rejectsWith(
      () => provider.createCheckout(CUSTOMER_PAYS_CHECKOUT),
      ProviderUnsupportedError,
    ))
  ) {
    failures.push("a checkout with split must be refused without split");
  }
  if (!capabilities.recipientOnboarding) {
    const recipient = await provider.createRecipient(PARTNER);
    if ((await provider.getRecipientStatus(recipient)) !== "not_required") {
      failures.push("recipient status must be not_required without onboarding");
    }
  }

  // Unsigned or forged input never turns into events.
  const forged = new TextEncoder().encode(
    JSON.stringify({ type: "payment.paid", id: "forged" }),
  );
  try {
    const events = await provider.verifyWebhook(forged, new Headers());
    if (events.length > 0) failures.push("unsigned webhook produced events");
  } catch {
    // Refusing is the expected outcome.
  }

  for (const amount of [0, -1, 1.5]) {
    if (
      !(await rejectsWith(
        () =>
          provider.refund({ provider: provider.key, externalId: "p" }, amount),
        Error,
      ))
    ) {
      failures.push(`refund of ${amount} cents must be refused`);
    }
  }

  for (const event of options.sampleEvents?.() ?? []) {
    failures.push(...checkEvent(provider, event));
  }
  return failures;
}

/** Checks for an adapter that is planned but switched off. */
export async function checkProviderNotConfigured(
  provider: PaymentProvider,
): Promise<string[]> {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["createRecipient", () => provider.createRecipient(PARTNER)],
    [
      "getRecipientStatus",
      () =>
        provider.getRecipientStatus({
          provider: provider.key,
          externalId: "r",
        }),
    ],
    ["upsertCustomer", () => provider.upsertCustomer(PARTNER)],
    ["createCheckout", () => provider.createCheckout(CUSTOMER_PAYS_CHECKOUT)],
    [
      "cancelSubscription",
      () =>
        provider.cancelSubscription({
          provider: provider.key,
          externalId: "s",
        }),
    ],
    [
      "refund",
      () => provider.refund({ provider: provider.key, externalId: "p" }, 100),
    ],
    [
      "verifyWebhook",
      () => provider.verifyWebhook(new Uint8Array(), new Headers()),
    ],
  ];
  const failures: string[] = [];
  for (const [name, call] of calls) {
    if (!(await rejectsWith(call, ProviderNotConfiguredError))) {
      failures.push(`${name} must answer "provedor não configurado"`);
    }
  }
  return failures;
}
