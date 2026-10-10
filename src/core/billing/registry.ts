import type { PaymentProvider, ProviderKey } from "./provider";
import { manualProvider } from "./providers/manual";
import { iuguProvider, stripeProvider } from "./providers/planned";

/**
 * Provider registry. One provider is active per partner (§3.4); in P5m only
 * the manual adapter is enabled, and the planned ones answer "provedor não
 * configurado" until P6 configures them.
 */
const PROVIDERS: Readonly<Record<ProviderKey, PaymentProvider>> = {
  manual: manualProvider,
  iugu: iuguProvider,
  stripe: stripeProvider,
};

const ENABLED: ReadonlySet<ProviderKey> = new Set(["manual"]);

export function getProvider(key: ProviderKey): PaymentProvider {
  return PROVIDERS[key];
}

export function isProviderEnabled(key: ProviderKey): boolean {
  return ENABLED.has(key);
}

export function listProviders(): ReadonlyArray<
  Readonly<{ provider: PaymentProvider; enabled: boolean }>
> {
  return Object.values(PROVIDERS).map((provider) => ({
    provider,
    enabled: ENABLED.has(provider.key),
  }));
}
