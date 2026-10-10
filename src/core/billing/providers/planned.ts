import {
  type PaymentProvider,
  type ProviderCapabilities,
  type ProviderKey,
  ProviderNotConfiguredError,
} from "../provider";

/**
 * Iugu and Stripe are planned (D-PA-07, D-PA-14) and switched off until P6:
 * the registry knows their capabilities, and every call answers "provedor
 * não configurado". The real adapters must pass the conformance suite.
 */
function plannedProvider(
  key: ProviderKey,
  capabilities: ProviderCapabilities,
): PaymentProvider {
  const notConfigured = async (): Promise<never> => {
    throw new ProviderNotConfiguredError(key);
  };
  return {
    key,
    capabilities,
    createRecipient: notConfigured,
    getRecipientStatus: notConfigured,
    upsertCustomer: notConfigured,
    createCheckout: notConfigured,
    cancelSubscription: notConfigured,
    refund: notConfigured,
    verifyWebhook: notConfigured,
  };
}

// §3.4: subaccounts with split per invoice; items marked [Verificar] there.
export const iuguProvider = plannedProvider("iugu", {
  split: true,
  recurring: true,
  methods: ["card", "pix", "boleto"],
  hostedCheckout: true,
  recipientOnboarding: true,
});

// §3.4: Connect; Pix and boleto in subscriptions still [Verificar].
export const stripeProvider = plannedProvider("stripe", {
  split: true,
  recurring: true,
  methods: ["card"],
  hostedCheckout: true,
  recipientOnboarding: true,
});
