import type { SpeechModel } from "ai";
import { MockSpeechModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { speakAnswer, type VoiceKey, voiceKeyOf } from "./speech";

/**
 * The voice of a GUIDS (A5d): the voice key, or the text key when it
 * speaks, and the answer spoken as one voice message.
 */

type Call = { text: string; voice?: string; outputFormat?: string };

function speaker(audio: Uint8Array, calls: Call[] = []) {
  return () =>
    new MockSpeechModelV4({
      doGenerate: async (options) => {
        calls.push({
          text: options.text,
          ...(options.voice ? { voice: options.voice } : {}),
          ...(options.outputFormat
            ? { outputFormat: options.outputFormat }
            : {}),
        });
        return {
          audio,
          warnings: [],
          response: { timestamp: new Date(), modelId: "mock" },
        };
      },
    }) as unknown as SpeechModel;
}

const openai: VoiceKey = {
  provider: "openai",
  secret: "sk",
  model: "gpt-4o-mini-tts",
  voice: "coral",
  speaks: true,
};

describe("voiceKeyOf", () => {
  it("speaks with the provider's model and default voice", () => {
    expect(voiceKeyOf({ provider: "gemini", secret: "g" }, {})).toEqual({
      provider: "gemini",
      secret: "g",
      model: "gemini-2.5-flash-preview-tts",
      voice: "Kore",
      speaks: true,
    });
  });

  it("keeps the tab's voice and model, and the switch off", () => {
    expect(
      voiceKeyOf(
        { provider: "openai", secret: "sk" },
        {
          audio_voice: "nova",
          audio_model: "tts-1",
          audio_enabled: false,
        },
      ),
    ).toMatchObject({ voice: "nova", model: "tts-1", speaks: false });
  });

  it("ignores a voice of another provider", () => {
    expect(
      voiceKeyOf({ provider: "openai", secret: "sk" }, { audio_voice: "Kore" })
        ?.voice,
    ).toBe("coral");
  });

  it("has no voice for keys that do not speak", () => {
    expect(voiceKeyOf({ provider: "anthropic", secret: "a" }, {})).toBeNull();
    expect(voiceKeyOf({ provider: "openrouter", secret: "o" }, {})).toBeNull();
  });
});

describe("speakAnswer", () => {
  it("speaks the whole answer in Opus with OpenAI", async () => {
    const calls: Call[] = [];
    const spoken = await speakAnswer(["Oi!", " Tudo bem? "], openai, {
      createSpeech: speaker(new Uint8Array([1, 2, 3]), calls),
    });
    expect(calls).toEqual([
      { text: "Oi!\n\nTudo bem?", voice: "coral", outputFormat: "opus" },
    ]);
    expect(spoken).toEqual({
      data: new Uint8Array([1, 2, 3]),
      mediaType: "audio/ogg",
      filename: "resposta.ogg",
    });
  });

  it("converts Gemini's WAV, or sends WAV without ffmpeg", async () => {
    const gemini = { ...openai, provider: "gemini" as const, voice: "Kore" };
    const wav = new Uint8Array([9, 9]);
    const converted = await speakAnswer(["Oi"], gemini, {
      createSpeech: speaker(wav),
      convert: async () => new Uint8Array([7]),
    });
    expect(converted).toMatchObject({
      data: new Uint8Array([7]),
      mediaType: "audio/ogg",
    });
    const raw = await speakAnswer(["Oi"], gemini, {
      createSpeech: speaker(wav),
      convert: async () => null,
    });
    expect(raw).toEqual({
      data: wav,
      mediaType: "audio/wav",
      filename: "resposta.wav",
    });
  });

  it("gives up quietly: the text answer goes instead", async () => {
    const failing = () =>
      new MockSpeechModelV4({
        doGenerate: async () => {
          throw new Error("down");
        },
      }) as unknown as SpeechModel;
    expect(
      await speakAnswer(["Oi"], openai, { createSpeech: failing }),
    ).toBeNull();
    expect(
      await speakAnswer(["  "], openai, {
        createSpeech: speaker(new Uint8Array([1])),
      }),
    ).toBeNull();
  });
});
