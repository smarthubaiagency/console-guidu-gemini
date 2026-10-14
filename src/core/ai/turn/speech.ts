import "server-only";

import { spawn } from "node:child_process";

import { generateSpeech } from "ai";

import type { AIProvider } from "@/core/credentials/vault";
import { appLog } from "@/lib/telemetry/log";

import type { AgentConfig } from "../config/schema";
import { voiceOptions } from "../media";
import { createSpeechModel, type SpeechFactory } from "../providers";

/**
 * The voice of a GUIDS (A5d, decided by Marcelo on 13/10/2026): the key
 * that hears the contact's audio and, when the contact sent audio, speaks
 * the answer. It is the model tab's voice key or, without one, the text
 * key when its provider has a voice (`../media.ts`). The platform's backup
 * never hears nor speaks.
 *
 * The answer is spoken as one voice message (Ogg Opus, WhatsApp's voice
 * note). OpenAI writes Opus; Gemini writes WAV, converted with `ffmpeg`
 * when the server has it (sent as WAV otherwise). A failed voice falls
 * back to the text answer.
 */

export type VoiceKey = Readonly<{
  provider: AIProvider;
  secret: string;
  /** The speech model (the tab's `audio_model` or the provider's). */
  model: string;
  voice: string;
  /** Answers in audio (`audio_enabled`, on unless turned off). */
  speaks: boolean;
}>;

export type SpokenAnswer = Readonly<{
  data: Uint8Array;
  mediaType: string;
  filename: string;
}>;

/** The most text spoken in one voice message. */
export const MAX_SPOKEN_CHARS = 2_000;
const SPEECH_TIMEOUT_MS = 60_000;
const CONVERT_TIMEOUT_MS = 20_000;

/** The voice of a key of this provider, with the tab's choices. */
export function voiceKeyOf(
  key: Readonly<{ provider: AIProvider; secret: string }>,
  model: AgentConfig["model"],
): VoiceKey | null {
  const options = voiceOptions(key.provider);
  if (!options) return null;
  const voice =
    model.audio_voice && options.voices.includes(model.audio_voice)
      ? model.audio_voice
      : options.defaultVoice;
  return {
    provider: key.provider,
    secret: key.secret,
    model: model.audio_model?.trim() || options.model,
    voice,
    speaks: model.audio_enabled !== false,
  };
}

/** WAV to Ogg Opus with the server's ffmpeg; null without it. */
export async function wavToOpus(wav: Uint8Array): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-i", "pipe:0"].concat([
          "-c:a",
          "libopus",
          "-b:a",
          "32k",
          "-f",
          "ogg",
          "pipe:1",
        ]),
        { stdio: ["pipe", "pipe", "ignore"] },
      );
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), CONVERT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      resolve(code === 0 && out.length > 0 ? out : null);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(wav));
  });
}

/** The answer as one voice message; null when it could not be spoken. */
export async function speakAnswer(
  messages: readonly string[],
  key: VoiceKey,
  deps: Readonly<{
    createSpeech?: SpeechFactory;
    convert?: (wav: Uint8Array) => Promise<Uint8Array | null>;
  }> = {},
): Promise<SpokenAnswer | null> {
  const text = messages
    .map((m) => m.trim())
    .filter((m) => m !== "")
    .join("\n\n")
    .slice(0, MAX_SPOKEN_CHARS);
  if (!text) return null;
  const model = (deps.createSpeech ?? createSpeechModel)(key);
  if (!model) return null;
  try {
    const opus = key.provider === "openai";
    const result = await generateSpeech({
      model,
      text,
      voice: key.voice,
      outputFormat: opus ? "opus" : "wav",
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
    });
    const audio = result.audio.uint8Array;
    if (audio.length === 0) return null;
    if (opus) {
      return { data: audio, mediaType: "audio/ogg", filename: "resposta.ogg" };
    }
    const converted = await (deps.convert ?? wavToOpus)(audio);
    return converted
      ? { data: converted, mediaType: "audio/ogg", filename: "resposta.ogg" }
      : { data: audio, mediaType: "audio/wav", filename: "resposta.wav" };
  } catch (error) {
    appLog.warn("ai.speech.failed", {
      provider: key.provider,
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
