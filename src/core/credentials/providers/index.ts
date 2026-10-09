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
  documentationUrl: string;
  // TODO(spec-ai-agents): O catálogo oficial de modelos e defaults será definido na especificação do módulo de Agentes de IA.
  supportedModels?: string[];
  defaultChatModel?: string;
  defaultEmbeddingModel?: string;
};

// TODO(spec-ai-agents): Catálogo de modelos e modelos padrão removidos (D1/ADR 0003/pendências).
// A lista formal de modelos homologados e defaults será definida na especificação do módulo.
export const AI_PROVIDERS: Record<AIProvider, AIProviderMetadata> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "Provedor OpenAI para modelos de linguagem e embeddings.",
    keyPrefix: "sk-",
    supportedModels: [],
    documentationUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    description: "Provedor Anthropic para a família Claude.",
    keyPrefix: "sk-ant-",
    supportedModels: [],
    documentationUrl: "https://console.anthropic.com/settings/keys",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    description: "Provedor Google para a família Gemini.",
    keyPrefix: "AIza",
    supportedModels: [],
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
