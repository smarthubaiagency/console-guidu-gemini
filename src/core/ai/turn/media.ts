import "server-only";

import { type FilePart, type ImagePart, transcribe } from "ai";

import type { AIProvider } from "@/core/credentials/vault";
import { appLog } from "@/lib/telemetry/log";

import { mediaCapabilities } from "../media";
import {
  createTranscriptionModel,
  type TranscriptionFactory,
} from "../providers";
import { format, type PromptTexts } from "../prompt/texts";

/**
 * Files a contact sent with a message (A5c, `../media.ts`). With the
 * customer's key, audio becomes its transcript and images and PDFs go to
 * the model with the message; plain text files are read as text. What the
 * key cannot read becomes a note that makes the agent ask the contact to
 * write. The notes and transcripts are kept on the message (the history);
 * the files themselves are not kept.
 */

export type TurnAttachment = Readonly<{
  kind: "audio" | "image" | "video" | "file";
  mimeType: string | null;
  /** Downloads the file, refused past `maxBytes`. */
  load(
    maxBytes: number,
  ): Promise<Readonly<{ data: Uint8Array; mediaType: string | null }>>;
}>;

export type MediaTexts = Readonly<{
  audioTranscript: string;
  audioUnsupported: string;
  audioFailed: string;
  image: string;
  imageUnsupported: string;
  document: string;
  documentText: string;
  documentUnsupported: string;
  fileFailed: string;
  video: string;
  unreadable: string;
}>;

export type PreparedMedia = Readonly<{
  notes: string[];
  parts: Array<ImagePart | FilePart>;
}>;

/** Files read per turn; the rest are noted as not opened. */
export const MAX_TURN_ATTACHMENTS = 4;

export const MEDIA_LIMITS = {
  audioBytes: 20_000_000,
  imageBytes: 5_000_000,
  documentBytes: 10_000_000,
  textBytes: 1_000_000,
  /** Characters of a text file put in the message. */
  textChars: 8_000,
  transcribeMs: 60_000,
} as const;

const TEXT_TYPES = new Set(["text/plain", "text/csv"]);

export function mediaTexts(texts: PromptTexts): MediaTexts {
  return texts.media as MediaTexts;
}

export async function prepareMedia(
  attachments: readonly TurnAttachment[],
  key: Readonly<{
    provider: AIProvider;
    secret: string;
    source: "customer" | "backup";
  }>,
  texts: MediaTexts,
  deps: Readonly<{ createTranscription?: TranscriptionFactory }> = {},
): Promise<PreparedMedia> {
  // The platform's backup only finishes conversations, in text.
  const caps =
    key.source === "customer"
      ? mediaCapabilities(key.provider)
      : { audio: false, image: false, document: false };
  const notes: string[] = [];
  const parts: Array<ImagePart | FilePart> = [];
  for (const [index, attachment] of attachments.entries()) {
    if (index >= MAX_TURN_ATTACHMENTS) {
      notes.push(texts.fileFailed);
      continue;
    }
    try {
      switch (attachment.kind) {
        case "video":
          notes.push(texts.video);
          break;
        case "audio": {
          const model = caps.audio
            ? (deps.createTranscription ?? createTranscriptionModel)(key)
            : null;
          if (!model) {
            notes.push(texts.audioUnsupported);
            break;
          }
          const file = await attachment.load(MEDIA_LIMITS.audioBytes);
          const result = await transcribe({
            model,
            audio: file.data,
            maxRetries: 1,
            abortSignal: AbortSignal.timeout(MEDIA_LIMITS.transcribeMs),
          });
          const text = result.text.trim();
          notes.push(
            text ? format(texts.audioTranscript, { text }) : texts.audioFailed,
          );
          break;
        }
        case "image": {
          if (!caps.image) {
            notes.push(texts.imageUnsupported);
            break;
          }
          const file = await attachment.load(MEDIA_LIMITS.imageBytes);
          const mediaType = file.mediaType ?? attachment.mimeType;
          if (!mediaType?.startsWith("image/")) {
            notes.push(texts.fileFailed);
            break;
          }
          parts.push({ type: "image", image: file.data, mediaType });
          notes.push(texts.image);
          break;
        }
        case "file": {
          const known = attachment.mimeType;
          if (known && !TEXT_TYPES.has(known) && known !== "application/pdf") {
            notes.push(texts.documentUnsupported);
            break;
          }
          if (known === "application/pdf" && !caps.document) {
            notes.push(texts.documentUnsupported);
            break;
          }
          const file = await attachment.load(MEDIA_LIMITS.documentBytes);
          const mediaType = file.mediaType ?? known;
          if (mediaType && TEXT_TYPES.has(mediaType)) {
            const text = Buffer.from(file.data)
              .toString("utf8")
              .slice(0, MEDIA_LIMITS.textChars)
              .trim();
            notes.push(
              text ? format(texts.documentText, { text }) : texts.fileFailed,
            );
          } else if (mediaType === "application/pdf" && caps.document) {
            parts.push({ type: "file", data: file.data, mediaType });
            notes.push(texts.document);
          } else {
            notes.push(texts.documentUnsupported);
          }
          break;
        }
      }
    } catch (error) {
      appLog.warn("ai.media.failed", {
        kind: attachment.kind,
        error: error instanceof Error ? error.name : "unknown",
      });
      notes.push(
        attachment.kind === "audio" ? texts.audioFailed : texts.fileFailed,
      );
    }
  }
  return { notes, parts };
}
