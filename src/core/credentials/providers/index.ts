/**
 * ============================================================================
 * File: src/core/credentials/providers/index.ts
 * Module: AI Provider Catalog & Validation Adapters
 *
 * Maintenance Rationale:
 * - Central catalog of external AI providers supported by the platform.
 * - Encapsulates models, capabilities, and format validation per provider.
 * - Adheres strictly to the invariant: "nenhum segredo no client".
 * ============================================================================
 */

import type { AIProvider } from "../vault";

export type AIProviderMetadata = {
  id: AIProvider;
  name: string;
  description: string;
  keyPrefix: string;
  defaultChatModel: string;
  defaultEmbeddingModel?: string;
  supportedModels: string[];
  documentationUrl: string;
};

export const AI_PROVIDERS: Record<AIProvider, AIProviderMetadata> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "Modelos GPT-4o, GPT-4o-mini e embeddings ada/text-embedding-3.",
    keyPrefix: "sk-",
    defaultChatModel: "gpt-4o-mini",
    defaultEmbeddingModel: "text-embedding-3-small",
    supportedModels: ["gpt-4o", "gpt-4o-mini", "text-embedding-3-small", "text-embedding-3-large"],
    documentationUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    description: "Família Claude 3.5 Sonnet e Claude 3 Haiku para raciocínio avançado.",
    keyPrefix: "sk-ant-",
    defaultChatModel: "claude-3-5-sonnet-latest",
    supportedModels: ["claude-3-5-sonnet-latest", "claude-3-haiku-20240307"],
    documentationUrl: "https://console.anthropic.com/settings/keys",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    description: "Modelos Gemini 2.5 Pro, Flash e embeddings multimodais de alta velocidade.",
    keyPrefix: "AIza",
    defaultChatModel: "gemini-2.5-flash",
    defaultEmbeddingModel: "text-embedding-004",
    supportedModels: ["gemini-2.5-flash", "gemini-2.5-pro", "text-embedding-004"],
    documentationUrl: "https://aistudio.google.com/app/apikey",
  },
};

/**
 * Validates the syntax of an API key for a specified provider.
 */
export function validateProviderKeyFormat(
  provider: AIProvider,
  key: string,
): { valid: boolean; error?: string } {
  const trimmed = key.trim();
  if (trimmed.length < 15) {
    return { valid: false, error: "A chave informada é muito curta." };
  }

  const meta = AI_PROVIDERS[provider];
  if (!meta) {
    return { valid: false, error: "Provedor desconhecido." };
  }

  if (meta.keyPrefix && !trimmed.startsWith(meta.keyPrefix)) {
    return {
      valid: false,
      error: `Formato inválido. A chave do ${meta.name} normalmente inicia com '${meta.keyPrefix}'.`,
    };
  }

  return { valid: true };
}
