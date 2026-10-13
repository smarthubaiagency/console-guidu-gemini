import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel, TranscriptionModel } from "ai";

import type { AIProvider } from "@/core/credentials/vault";

/**
 * The model of one call (ADR 0017, A2b). The provider is created per call
 * with the key decrypted on the server and dropped with the call: no global
 * provider holds a key, and nothing reads keys from the environment.
 */

export type ChatModelKey = Readonly<{
  provider: AIProvider;
  secret: string;
  model: string;
}>;

/** Builds the model of a call; tests pass a mock from `ai/test` instead. */
export type ModelFactory = (key: ChatModelKey) => LanguageModel;

export const createChatModel: ModelFactory = ({ provider, secret, model }) => {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: secret })(model);
    case "anthropic":
      return createAnthropic({ apiKey: secret })(model);
    case "gemini":
      return createGoogle({ apiKey: secret })(model);
    case "openrouter":
      return createOpenRouter({ apiKey: secret }).chat(model);
  }
};

/** Speech model used to read a contact's audio with the customer's key (A5c). */
export const TRANSCRIPTION_MODELS: Partial<Record<AIProvider, string>> = {
  openai: "gpt-4o-mini-transcribe",
  gemini: "gemini-3.5-transcribe",
};

export type TranscriptionFactory = (
  key: Omit<ChatModelKey, "model">,
) => TranscriptionModel | null;

/** The provider's speech model, or null when it has none here. */
export const createTranscriptionModel: TranscriptionFactory = ({
  provider,
  secret,
}) => {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: secret }).transcription(
        TRANSCRIPTION_MODELS.openai!,
      );
    case "gemini":
      return createGoogle({ apiKey: secret }).transcription(
        TRANSCRIPTION_MODELS.gemini!,
      );
    default:
      return null;
  }
};
