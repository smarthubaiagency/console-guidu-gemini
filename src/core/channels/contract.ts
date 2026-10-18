import { z } from "zod";

/**
 * Contract of the channel layer (ADR 0011, canais.md §3.2), version 1.
 * Adapters turn a provider's webhook into these normalized events; the
 * consumers (ai-agents from A5b) only ever see them, never the provider's
 * raw payload nor the connection's secrets. New fields are added in a
 * compatible way; consumers ignore what they do not know.
 */

export const CHANNEL_CONTRACT_VERSION = 1;

export const CHANNEL_KINDS = ["chatwoot", "meta_whatsapp"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Longest text of one inbound message kept by the core. */
export const MAX_INBOUND_TEXT = 20_000;
/** Largest webhook body read by the core. */
export const MAX_WEBHOOK_BYTES = 1_000_000;
/** Most events of one webhook call. */
export const MAX_EVENTS_PER_CALL = 50;

const id = z.string().min(1).max(200);

export const InboundAttachment = z.strictObject({
  kind: z.enum(["audio", "image", "video", "file"]),
  /** Where the core downloads it, restricted to the provider's host. */
  url: z.url().max(2000),
  mimeType: z.string().max(120).nullable(),
  size: z.number().int().nonnegative().nullable(),
});
export type InboundAttachment = z.infer<typeof InboundAttachment>;

export const InboundEvent = z.strictObject({
  contractVersion: z.literal(CHANNEL_CONTRACT_VERSION),
  /** The provider's id of the event: the key against retries. */
  externalId: id,
  kind: z.enum(["message", "conversation_status"]),
  /** Who sent it; only `contact` messages may start a consumer's turn. */
  sender: z.enum(["contact", "agent", "bot", "system"]),
  /**
   * Chatwoot: the inbox; Meta: the number (`phone_number_id`). The route of
   * (connection, scope) owns it.
   */
  scope: id,
  occurredAt: z.iso.datetime({ offset: true }).nullable(),
  conversation: z.strictObject({
    externalId: id,
    contactId: id.nullable(),
    /** The provider's status of the conversation (Chatwoot: pending, open…). */
    status: z.string().max(40).nullable(),
  }),
  contact: z
    .strictObject({
      externalId: id.nullable(),
      name: z.string().max(200).nullable(),
      phone: z.string().max(40).nullable(),
      email: z.string().max(254).nullable(),
    })
    .nullable(),
  message: z
    .strictObject({
      text: z.string().max(MAX_INBOUND_TEXT),
      /** An internal note of the team: context, never a trigger. */
      private: z.boolean(),
      attachments: z.array(InboundAttachment).max(20),
    })
    .nullable(),
});
export type InboundEvent = z.infer<typeof InboundEvent>;

/** What a channel takes in and puts out (canais.md §3.2). */
export type ChannelCapabilities = Readonly<{
  input: Readonly<{
    text: boolean;
    audio: boolean;
    image: boolean;
    file: boolean;
  }>;
  output: Readonly<{
    text: Readonly<{
      maxLength: number;
      format: "plain" | "markdown" | "html";
    }> | null;
    audio: Readonly<{
      mimeTypes: readonly string[];
      voiceNote: boolean;
    }> | null;
    json: boolean;
  }>;
  typingIndicator: boolean;
  /** Meta: free text only within 24 hours of the contact's last message. */
  messagingWindow?: "meta_24h";
}>;

/** A health check of a connection; `code` never carries a secret. */
export type ChannelHealth = Readonly<{
  ok: boolean;
  code: string | null;
}>;
