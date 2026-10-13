import "server-only";

import { z } from "zod";

import {
  CHANNEL_CONTRACT_VERSION,
  type ChannelCapabilities,
  type ChannelHealth,
  type InboundAttachment,
  InboundEvent,
  MAX_EVENTS_PER_CALL,
  MAX_INBOUND_TEXT,
} from "./contract";
import { type ChannelFetch, ChannelHttpError, providerJson } from "./http";

/**
 * Adapter of Chatwoot through an Agent Bot (canais.md §3.3, ADR 0011).
 *
 * - The connection keeps the account's base address and id and an access
 *   token of an administrator of the account. With it the core creates the
 *   account's Agent Bot, whose `outgoing_url` is the connection's webhook,
 *   lists the inboxes and, from the A5b, puts the bot on an inbox.
 * - The bot's own token sends the answers, so they show as the bot's.
 * - The Agent Bot webhook is not signed: the URL carries a random token of
 *   the connection, kept only as its hash (src/core/channels/webhook.ts).
 * - Only an incoming, public message of a contact may start a turn; the
 *   team's messages, notes and the bot's own messages stay as context.
 */

export const CHATWOOT_CAPABILITIES: ChannelCapabilities = {
  input: { text: true, audio: true, image: true, file: true },
  output: {
    text: { maxLength: 4000, format: "markdown" },
    audio: { mimeTypes: ["audio/mpeg", "audio/ogg"], voiceNote: false },
    json: false,
  },
  typingIndicator: true,
};

/** Non-secret settings of a Chatwoot connection (`channel_connections.config`). */
export const ChatwootConfig = z.object({
  base_url: z.url(),
  account_id: z.number().int().positive(),
  agent_bot_id: z.number().int().positive(),
  /** The inboxes seen by the last check, for the screens. */
  inboxes: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        channel_type: z.string().nullable(),
      }),
    )
    .default([]),
});
export type ChatwootConfig = z.infer<typeof ChatwootConfig>;

/** The secrets, encrypted together in `encrypted_secrets`. */
export const ChatwootSecrets = z.strictObject({
  userToken: z.string().min(8).max(200),
  botToken: z.string().min(8).max(200),
});
export type ChatwootSecrets = z.infer<typeof ChatwootSecrets>;

// ---------------------------------------------------------------------------
// Normalization of the webhook
// ---------------------------------------------------------------------------

const numberish = z.union([z.number(), z.string()]);

const Sender = z
  .object({
    id: numberish.nullish(),
    name: z.string().nullish(),
    type: z.string().nullish(),
    phone_number: z.string().nullish(),
    email: z.string().nullish(),
  })
  .passthrough();

const Conversation = z
  .object({
    id: numberish,
    status: z.string().nullish(),
    inbox_id: numberish.nullish(),
    contact_inbox: z
      .object({ contact_id: numberish.nullish() })
      .passthrough()
      .nullish(),
    meta: z.object({ sender: Sender.nullish() }).passthrough().nullish(),
  })
  .passthrough();

const Attachment = z
  .object({
    file_type: z.string().nullish(),
    data_url: z.string().nullish(),
    file_size: z.number().nullish(),
    extension: z.string().nullish(),
  })
  .passthrough();

const MessageCreated = z
  .object({
    event: z.literal("message_created"),
    id: numberish,
    content: z.string().nullish(),
    message_type: z.union([z.string(), z.number()]).nullish(),
    private: z.boolean().nullish(),
    created_at: z.union([z.string(), z.number()]).nullish(),
    sender: Sender.nullish(),
    conversation: Conversation,
    inbox: z.object({ id: numberish }).passthrough().nullish(),
    attachments: z.array(Attachment).nullish(),
  })
  .passthrough();

const StatusChanged = z
  .object({
    event: z.enum(["conversation_status_changed", "conversation_updated"]),
    id: numberish,
    status: z.string().nullish(),
    inbox_id: numberish.nullish(),
    updated_at: z.union([z.string(), z.number()]).nullish(),
    timestamp: z.union([z.string(), z.number()]).nullish(),
    contact_inbox: z
      .object({ contact_id: numberish.nullish() })
      .passthrough()
      .nullish(),
    meta: z.object({ sender: Sender.nullish() }).passthrough().nullish(),
  })
  .passthrough();

const MESSAGE_TYPES = ["incoming", "outgoing", "activity", "template"];

function text(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function idOf(value: string | number | null | undefined): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : String(value).slice(0, 200);
}

function timeOf(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date =
    typeof value === "number" || /^\d+$/.test(value)
      ? new Date(Number(value) * 1000)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function messageType(value: string | number | null | undefined): string {
  return typeof value === "number"
    ? (MESSAGE_TYPES[value] ?? "unknown")
    : (value ?? "unknown");
}

function senderOf(
  type: string,
  sender: z.infer<typeof Sender> | null | undefined,
): InboundEvent["sender"] {
  if (type === "incoming") return "contact";
  if (type === "outgoing") {
    const kind = sender?.type?.toLowerCase() ?? "";
    return kind.includes("bot") ? "bot" : "agent";
  }
  return "system";
}

function attachmentKind(fileType: string | null | undefined) {
  switch (fileType) {
    case "audio":
      return "audio" as const;
    case "image":
      return "image" as const;
    case "video":
      return "video" as const;
    default:
      return "file" as const;
  }
}

function attachmentsOf(
  list: z.infer<typeof Attachment>[] | null | undefined,
): InboundAttachment[] {
  return (list ?? []).slice(0, 20).flatMap((item) => {
    const url = item.data_url ?? "";
    if (!/^https?:\/\//.test(url) || url.length > 2000) return [];
    return [
      {
        kind: attachmentKind(item.file_type),
        url,
        mimeType: null,
        size:
          typeof item.file_size === "number" && item.file_size >= 0
            ? Math.trunc(item.file_size)
            : null,
      },
    ];
  });
}

function contactOf(
  sender: z.infer<typeof Sender> | null | undefined,
): InboundEvent["contact"] {
  if (!sender) return null;
  return {
    externalId: idOf(sender.id),
    name: text(sender.name, 200),
    phone: text(sender.phone_number, 40),
    email: text(sender.email, 254),
  };
}

/**
 * The events of one webhook call of the Agent Bot. Unknown events and
 * payloads that do not parse give nothing (the provider is answered 200 and
 * the call leaves no trace beyond the log).
 */
export function normalizeChatwoot(body: unknown): InboundEvent[] {
  const items = Array.isArray(body) ? body : [body];
  const events: InboundEvent[] = [];
  for (const item of items.slice(0, MAX_EVENTS_PER_CALL)) {
    const event = normalizeOne(item);
    if (event) events.push(event);
  }
  return events;
}

/** An event out of the contract is dropped, never a 500 the provider retries. */
function valid(event: unknown): InboundEvent | null {
  const parsed = InboundEvent.safeParse(event);
  return parsed.success ? parsed.data : null;
}

function normalizeOne(item: unknown): InboundEvent | null {
  const message = MessageCreated.safeParse(item);
  if (message.success) {
    const data = message.data;
    const scope = idOf(data.inbox?.id ?? data.conversation.inbox_id);
    if (!scope) return null;
    const type = messageType(data.message_type);
    const sender = senderOf(type, data.sender);
    const contactSender =
      sender === "contact" ? data.sender : data.conversation.meta?.sender;
    return valid({
      contractVersion: CHANNEL_CONTRACT_VERSION,
      externalId: `message:${idOf(data.id)}`,
      kind: "message",
      sender,
      scope,
      occurredAt: timeOf(data.created_at),
      conversation: {
        externalId: String(data.conversation.id),
        contactId: idOf(data.conversation.contact_inbox?.contact_id),
        status: text(data.conversation.status, 40),
      },
      contact: contactOf(contactSender),
      message: {
        text: (data.content ?? "").slice(0, MAX_INBOUND_TEXT),
        private: data.private === true,
        attachments: attachmentsOf(data.attachments),
      },
    });
  }
  const status = StatusChanged.safeParse(item);
  if (status.success) {
    const data = status.data;
    const scope = idOf(data.inbox_id);
    const value = text(data.status, 40);
    if (!scope || !value) return null;
    const at = timeOf(data.updated_at ?? data.timestamp);
    return valid({
      contractVersion: CHANNEL_CONTRACT_VERSION,
      externalId: `status:${idOf(data.id)}:${value}:${at ?? "unknown"}`,
      kind: "conversation_status",
      sender: "system",
      scope,
      occurredAt: at,
      conversation: {
        externalId: String(data.id),
        contactId: idOf(data.contact_inbox?.contact_id),
        status: value,
      },
      contact: contactOf(data.meta?.sender),
      message: null,
    });
  }
  return null;
}

/** Whether an event may start a consumer's turn (canais.md §4, step 2). */
export function isTrigger(event: InboundEvent): boolean {
  return (
    event.kind === "message" &&
    event.sender === "contact" &&
    event.message !== null &&
    !event.message.private &&
    (event.message.text.trim() !== "" || event.message.attachments.length > 0)
  );
}

// ---------------------------------------------------------------------------
// API of the account
// ---------------------------------------------------------------------------

type Deps = Readonly<{ fetch?: ChannelFetch }>;

export type ChatwootAccount = Readonly<{
  baseUrl: string;
  accountId: number;
}>;

export type ChatwootInbox = Readonly<{
  id: number;
  name: string;
  channel_type: string | null;
}>;

const AgentBotResponse = z
  .object({
    id: z.number().int().positive(),
    access_token: z.string().min(8).max(200),
  })
  .passthrough();

const InboxesResponse = z
  .object({
    payload: z.array(
      z
        .object({
          id: z.number().int(),
          name: z.string().max(200),
          channel_type: z.string().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function accountUrl(account: ChatwootAccount, path: string): string {
  return `${account.baseUrl}/api/v1/accounts/${account.accountId}${path}`;
}

function headers(token: string): HeadersInit {
  return {
    api_access_token: token,
    "content-type": "application/json",
    accept: "application/json",
  };
}

/** Creates the account's Agent Bot that calls the connection's webhook. */
export async function createAgentBot(
  account: ChatwootAccount,
  userToken: string,
  input: Readonly<{ name: string; outgoingUrl: string }>,
  deps: Deps = {},
): Promise<Readonly<{ id: number; accessToken: string }>> {
  const raw = await providerJson(
    accountUrl(account, "/agent_bots"),
    {
      method: "POST",
      headers: headers(userToken),
      body: JSON.stringify({
        name: input.name,
        description: "GUIDU",
        outgoing_url: input.outgoingUrl,
        bot_type: 0,
      }),
    },
    deps,
  );
  const parsed = AgentBotResponse.safeParse(raw);
  if (!parsed.success) throw new ChannelHttpError("invalid_response");
  return { id: parsed.data.id, accessToken: parsed.data.access_token };
}

/** Removes the account's Agent Bot of the connection. */
export async function deleteAgentBot(
  account: ChatwootAccount,
  userToken: string,
  botId: number,
  deps: Deps = {},
): Promise<void> {
  await providerJson(
    accountUrl(account, `/agent_bots/${botId}`),
    { method: "DELETE", headers: headers(userToken) },
    deps,
  );
}

/** The inboxes of the account. */
export async function listInboxes(
  account: ChatwootAccount,
  userToken: string,
  deps: Deps = {},
): Promise<ChatwootInbox[]> {
  const raw = await providerJson(
    accountUrl(account, "/inboxes"),
    { method: "GET", headers: headers(userToken) },
    deps,
  );
  const parsed = InboxesResponse.safeParse(raw);
  if (!parsed.success) throw new ChannelHttpError("invalid_response");
  return parsed.data.payload.slice(0, 200).map((inbox) => ({
    id: inbox.id,
    name: inbox.name,
    channel_type: inbox.channel_type ?? null,
  }));
}

/** The account answers with this token and the bot is still there. */
export async function checkChatwoot(
  account: ChatwootAccount,
  secrets: ChatwootSecrets,
  botId: number,
  deps: Deps = {},
): Promise<ChannelHealth & Readonly<{ inboxes: ChatwootInbox[] }>> {
  const failed = (error: unknown, notFound: string) => {
    if (!(error instanceof ChannelHttpError)) throw error;
    return {
      ok: false,
      code: error.code === "not_found" ? notFound : error.code,
      inboxes: [],
    };
  };
  let inboxes: ChatwootInbox[];
  try {
    inboxes = await listInboxes(account, secrets.userToken, deps);
  } catch (error) {
    return failed(error, "account_missing");
  }
  try {
    await providerJson(
      accountUrl(account, `/agent_bots/${botId}`),
      { method: "GET", headers: headers(secrets.userToken) },
      deps,
    );
  } catch (error) {
    return failed(error, "bot_missing");
  }
  return { ok: true, code: null, inboxes };
}
