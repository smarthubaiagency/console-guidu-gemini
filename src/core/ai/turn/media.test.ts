import type { TranscriptionModel } from "ai";
import { MockTranscriptionModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { promptTexts } from "../prompt/texts";
import { mediaTexts, prepareMedia, type TurnAttachment } from "./media";

/**
 * Files a contact sends (A5c): read with the customer's key when its
 * provider can, and turned into a request to write when it cannot.
 */

const texts = mediaTexts(promptTexts("pt-BR"));

function file(
  kind: TurnAttachment["kind"],
  mediaType: string | null,
  body = "conteúdo",
  mimeType: string | null = null,
): TurnAttachment & { loads: number[] } {
  const loads: number[] = [];
  return {
    kind,
    mimeType,
    loads,
    load: async (maxBytes) => {
      loads.push(maxBytes);
      return { data: new TextEncoder().encode(body), mediaType };
    },
  };
}

const transcriber = (text: string) =>
  new MockTranscriptionModelV4({
    doGenerate: async () => ({
      text,
      segments: [],
      language: "pt",
      durationInSeconds: 3,
      warnings: [],
      response: { timestamp: new Date(), modelId: "mock" },
    }),
  });

const openai = {
  provider: "openai",
  secret: "sk",
  source: "customer",
} as const;

describe("prepareMedia", () => {
  it("transcribes audio with a key that hears", async () => {
    const audio = file("audio", "audio/ogg");
    const prepared = await prepareMedia([audio], openai, texts, {
      createTranscription: () =>
        transcriber("Quero o preço do plano") as unknown as TranscriptionModel,
    });
    expect(prepared.notes).toEqual([
      "[Áudio do contato, transcrito]: Quero o preço do plano",
    ]);
    expect(prepared.parts).toEqual([]);
  });

  it("hears with the voice key when the text key does not (A5d)", async () => {
    const audio = file("audio", "audio/ogg");
    const keys: string[] = [];
    const prepared = await prepareMedia(
      [audio],
      {
        provider: "anthropic",
        secret: "sk",
        source: "customer",
        voice: { provider: "openai", secret: "voice" },
      },
      texts,
      {
        createTranscription: (key) => {
          keys.push(`${key.provider}:${key.secret}`);
          return transcriber("Oi") as unknown as TranscriptionModel;
        },
      },
    );
    expect(keys).toEqual(["openai:voice"]);
    expect(prepared.notes).toEqual(["[Áudio do contato, transcrito]: Oi"]);
  });

  it("does not hear when the voice was resolved to none", async () => {
    const audio = file("audio", "audio/ogg");
    const prepared = await prepareMedia(
      [audio],
      { ...openai, voice: null },
      texts,
    );
    expect(prepared.notes).toEqual([texts.audioUnsupported]);
    expect(audio.loads).toEqual([]);
  });

  it("asks for text when the key does not hear, without downloading", async () => {
    const audio = file("audio", "audio/ogg");
    const prepared = await prepareMedia(
      [audio],
      { provider: "anthropic", secret: "sk", source: "customer" },
      texts,
    );
    expect(prepared.notes).toEqual([texts.audioUnsupported]);
    expect(audio.loads).toEqual([]);
  });

  it("sends images and PDFs to the model and reads text files", async () => {
    const prepared = await prepareMedia(
      [
        file("image", "image/png"),
        file("file", "application/pdf", "%PDF", "application/pdf"),
        file("file", "text/csv", "produto,preço\nA,10", "text/csv"),
      ],
      openai,
      texts,
    );
    expect(prepared.parts.map((p) => p.type)).toEqual(["image", "file"]);
    expect(prepared.notes).toEqual([
      texts.image,
      texts.document,
      "[Arquivo de texto do contato]:\nproduto,preço\nA,10",
    ]);
  });

  it("refuses PDFs and other documents a key cannot read", async () => {
    const pdf = file("file", "application/pdf", "%PDF", "application/pdf");
    const prepared = await prepareMedia(
      [pdf, file("file", null, "x", "application/zip"), file("video", null)],
      { provider: "openrouter", secret: "sk", source: "customer" },
      texts,
    );
    expect(prepared.notes).toEqual([
      texts.documentUnsupported,
      texts.documentUnsupported,
      texts.video,
    ]);
    expect(pdf.loads).toEqual([]);
  });

  it("reads nothing with the platform's backup key", async () => {
    const prepared = await prepareMedia(
      [file("image", "image/png")],
      { provider: "openai", secret: "sk", source: "backup" },
      texts,
    );
    expect(prepared).toEqual({
      notes: [texts.imageUnsupported],
      parts: [],
    });
  });

  it("notes a file that could not be opened", async () => {
    const broken: TurnAttachment = {
      kind: "image",
      mimeType: null,
      load: async () => {
        throw new Error("too_large");
      },
    };
    const notImage = file("image", "text/html");
    const prepared = await prepareMedia([broken, notImage], openai, texts);
    expect(prepared.notes).toEqual([texts.fileFailed, texts.fileFailed]);
  });

  it("reads at most four files of a turn", async () => {
    const many = Array.from({ length: 5 }, () => file("image", "image/png"));
    const prepared = await prepareMedia(many, openai, texts);
    expect(prepared.parts).toHaveLength(4);
    expect(prepared.notes.at(-1)).toBe(texts.fileFailed);
  });
});
