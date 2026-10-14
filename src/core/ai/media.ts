import type { AIProvider } from "@/core/credentials/vault";

/**
 * What a GUIDS can take from a contact besides text, by the provider of its
 * key (A5c, decided by Marcelo on 13/10/2026): the customer's own key reads
 * the files, and a key that cannot read one makes the agent ask the
 * contact to write instead. The screens of keys and channels show it, so
 * the customer knows the agent does less with such a key.
 *
 * - Audio is transcribed with the provider's speech model (OpenAI and
 *   Gemini); the agent reads the text.
 * - Images and PDF documents go to the chat model with the message; a
 *   model of the provider that cannot see them falls back to the request
 *   to write. Plain text and CSV files are read as text by any key.
 * - Video is not read by any key yet.
 */

export type MediaKind = "audio" | "image" | "document";

export type MediaCapabilities = Readonly<Record<MediaKind, boolean>>;

export const MEDIA_CAPABILITIES: Readonly<
  Record<AIProvider, MediaCapabilities>
> = {
  openai: { audio: true, image: true, document: true },
  anthropic: { audio: false, image: true, document: true },
  gemini: { audio: true, image: true, document: true },
  openrouter: { audio: false, image: true, document: false },
};

export const MEDIA_KINDS: readonly MediaKind[] = ["audio", "image", "document"];

export function mediaCapabilities(provider: string): MediaCapabilities {
  return (
    MEDIA_CAPABILITIES[provider as AIProvider] ?? {
      audio: false,
      image: false,
      document: false,
    }
  );
}

/** The kinds a key of this provider does not read (empty: all of them). */
export function missingMedia(provider: string): MediaKind[] {
  const caps = mediaCapabilities(provider);
  return MEDIA_KINDS.filter((kind) => !caps[kind]);
}

/**
 * The voice of a GUIDS (A5d): the provider's speech model and its voices,
 * for the agent to answer in audio when the contact sent audio. Only the
 * providers with a speech model here have voice; the customer picks a
 * voice key of one of them when the text key has none.
 */
export type VoiceOptions = Readonly<{
  model: string;
  voices: readonly string[];
  defaultVoice: string;
}>;

export const VOICE_OPTIONS: Readonly<
  Partial<Record<AIProvider, VoiceOptions>>
> = {
  openai: {
    model: "gpt-4o-mini-tts",
    voices: [
      "coral",
      "alloy",
      "ash",
      "ballad",
      "echo",
      "fable",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
    ],
    defaultVoice: "coral",
  },
  gemini: {
    model: "gemini-2.5-flash-preview-tts",
    voices: [
      "Kore",
      "Puck",
      "Charon",
      "Aoede",
      "Fenrir",
      "Leda",
      "Orus",
      "Zephyr",
    ],
    defaultVoice: "Kore",
  },
};

/** The voice options of a provider, or null when its keys do not speak. */
export function voiceOptions(provider: string): VoiceOptions | null {
  return VOICE_OPTIONS[provider as AIProvider] ?? null;
}
