import type { AIProvider } from "@/core/credentials/vault";

/**
 * Failure of an AI provider call, carrying only the provider and the HTTP
 * status: never the key, the prompt or the provider's message. `toSafeError`
 * maps it to `provider_error`.
 */
export class ProviderError extends Error {
  readonly provider: AIProvider;
  readonly status: number;

  constructor(provider: AIProvider, status: number) {
    super(`AI provider ${provider} returned HTTP ${status}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}
