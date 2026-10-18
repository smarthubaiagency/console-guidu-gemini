import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  CHANNEL_CONTRACT_VERSION,
  type ChannelCapabilities,
  type InboundAttachment,
  InboundEvent,
  MAX_EVENTS_PER_CALL,
  MAX_INBOUND_TEXT,
} from "./contract";
import {
  authorizedDownload,
  type ChannelFetch,
  ChannelHttpError,
  providerJson,
} from "./http";

/**
 * Adapter of the WhatsApp Cloud API of Meta (IN7a, canais.md, Meta row;
 * plano-in7.md §2).
 *
 * - One app of the GUIDU on Meta: its app secret signs every webhook
 *   (`X-Hub-Signature-256`, HMAC-SHA256 of the raw body) and its verify
 *   token answers the challenge of the webhook's registration. Both come
 *   from the platform's environment, never from the database.
 * - A connection is one number (`phone_number_id`) of a WhatsApp Business
 *   account (`waba_id`), with a token of the customer's business, kept
 *   encrypted. It is linked by hand (a system user's token) or by the
 *   Embedded Signup (a code exchanged with the app secret).
 * - The contact's media comes by id: the Graph API gives a short-lived
 *   link, downloaded with the token.
 * - Outside 24 hours after the contact's last message Meta only takes an
 *   approved template (`messagingWindow: "meta_24h"`): the core checks it
 *   before sending free text.
 */

export const META_GRAPH_DEFAULT = "https://graph.facebook.com/v21.0";
/** The 24-hour window of Meta. */
export const META_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Largest file of a contact the core takes (Meta's own limit for media). */
export const MAX_META_MEDIA_BYTES = 16 * 1024 * 1024;
/** Longest text Meta takes in one message. */
export const MAX_META_TEXT = 4096;

export const META_CAPABILITIES: ChannelCapabilities = {
  input: { text: true, audio: true, image: true, file: true },
  output: {
    text: { maxLength: MAX_META_TEXT, format: "plain" },
    audio: null,
    json: false,
  },
  typingIndicator: false,
  messagingWindow: "meta_24h",
};

/** The Graph API of Meta; a double in the tests (`META_GRAPH_URL`). */
export function metaGraphBase(): string {
  return (process.env.META_GRAPH_URL?.trim() || META_GRAPH_DEFAULT).replace(
    /\/+$/,
    "",
  );
}

export type MetaApp = Readonly<{
  appId: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  /** Configuration of the Facebook Login for Business (Embedded Signup). */
  embeddedConfigId: string | null;
}>;

export function metaApp(): MetaApp {
  const read = (name: string) => process.env[name]?.trim() || null;
  return {
    appId: read("META_APP_ID"),
    appSecret: read("META_APP_SECRET"),
    verifyToken: read("META_WEBHOOK_VERIFY_TOKEN"),
    embeddedConfigId: read("META_EMBEDDED_SIGNUP_CONFIG_ID"),
  };
}

const NUMBER_ID = /^[0-9]{5,30}$/;

export const MetaConfig = z.object({
  phone_number_id: z.string().regex(NUMBER_ID),
  waba_id: z.string().regex(NUMBER_ID),
  display_phone_number: z.string().max(40).nullable(),
  verified_name: z.string().max(200).nullable(),
  linked_via: z.enum(["manual", "embedded"]),
});
export type MetaConfig = z.infer<typeof MetaConfig>;

export const MetaSecrets = z.object({ accessToken: z.string().min(8) });
export type MetaSecrets = z.infer<typeof MetaSecrets>;

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** Whether the signature header is the app secret's HMAC of the raw body. */
export function verifyMetaSignature(
  raw: string,
  header: string | null,
  appSecret: string,
): boolean {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  if (!match?.[1]) return false;
  const expected = createHmac("sha256", appSecret).update(raw, "utf8").digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A status Meta reports on a message the core sent. */
export type MetaStatus = Readonly<{
  externalId: string;
  status: "sent" | "delivered" | "read" | "failed";
  error: string | null;
}>;

export type MetaBatch = Readonly<{
  phoneNumberId: string;
  events: InboundEvent[];
  statuses: MetaStatus[];
}>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const MEDIA_KINDS: Record<string, InboundAttachment["kind"]> = {
  image: "image",
  sticker: "image",
  audio: "audio",
  video: "video",
  document: "file",
};

/** The text of a message, or a caption, or a reply to buttons and lists. */
function textOf(type: string, message: Record<string, unknown>): string {
  if (type === "text") return str(record(message.text).body) ?? "";
  if (type === "button") return str(record(message.button).text) ?? "";
  if (type === "interactive") {
    const interactive = record(message.interactive);
    return (
      str(record(interactive.button_reply).title) ??
      str(record(interactive.list_reply).title) ??
      ""
    );
  }
  return str(record(message[type]).caption) ?? "";
}

function attachmentOf(
  type: string,
  message: Record<string, unknown>,
  graph: string,
): InboundAttachment | null {
  const kind = MEDIA_KINDS[type];
  const media = record(message[type]);
  const id = str(media.id);
  if (!kind || !id || !NUMBER_ID.test(id)) return null;
  return {
    kind,
    // Where the core asks for the file's link (with the token).
    url: `${graph}/${id}`,
    mimeType: str(media.mime_type)?.slice(0, 120) ?? null,
    size: null,
  };
}

/**
 * The normalized events of a webhook call of Meta, grouped by number.
 * Only messages of a contact; statuses go apart. What does not fit the
 * contract is left out.
 */
export function normalizeMeta(
  body: unknown,
  graph: string = metaGraphBase(),
): MetaBatch[] {
  const root = record(body);
  if (root.object !== "whatsapp_business_account") return [];
  const batches = new Map<string, { events: InboundEvent[]; statuses: MetaStatus[] }>();
  let count = 0;
  for (const entry of list(root.entry)) {
    for (const change of list(record(entry).changes)) {
      const { field, value: rawValue } = record(change);
      if (field !== "messages") continue;
      const value = record(rawValue);
      const phoneNumberId = str(record(value.metadata).phone_number_id);
      if (!phoneNumberId || !NUMBER_ID.test(phoneNumberId)) continue;
      const batch = batches.get(phoneNumberId) ?? { events: [], statuses: [] };
      batches.set(phoneNumberId, batch);
      const names = new Map<string, string>();
      for (const contact of list(value.contacts)) {
        const waId = str(record(contact).wa_id);
        const name = str(record(record(contact).profile).name);
        if (waId && name) names.set(waId, name.slice(0, 200));
      }
      for (const raw of list(value.messages)) {
        if (count >= MAX_EVENTS_PER_CALL) break;
        const message = record(raw);
        const id = str(message.id);
        const from = str(message.from);
        const type = str(message.type) ?? "";
        if (!id || !from || !/^[0-9]{6,20}$/.test(from)) continue;
        const seconds = Number(message.timestamp);
        const attachment = attachmentOf(type, message, graph);
        const parsed = InboundEvent.safeParse({
          contractVersion: CHANNEL_CONTRACT_VERSION,
          externalId: id.slice(0, 200),
          kind: "message",
          sender: "contact",
          scope: phoneNumberId,
          occurredAt: Number.isFinite(seconds)
            ? new Date(seconds * 1000).toISOString()
            : null,
          conversation: { externalId: from, contactId: from, status: null },
          contact: {
            externalId: from,
            name: names.get(from) ?? null,
            phone: from,
            email: null,
          },
          message: {
            text: textOf(type, message).slice(0, MAX_INBOUND_TEXT),
            private: false,
            attachments: attachment ? [attachment] : [],
          },
        });
        if (!parsed.success) continue;
        batch.events.push(parsed.data);
        count += 1;
      }
      for (const raw of list(value.statuses)) {
        const status = record(raw);
        const id = str(status.id);
        const state = str(status.status);
        if (
          !id ||
          !state ||
          !["sent", "delivered", "read", "failed"].includes(state)
        ) {
          continue;
        }
        const code = record(list(status.errors)[0]).code;
        batch.statuses.push({
          externalId: id.slice(0, 200),
          status: state as MetaStatus["status"],
          error:
            state === "failed"
              ? `meta_${typeof code === "number" || typeof code === "string" ? String(code).slice(0, 20) : "failed"}`
              : null,
        });
      }
    }
  }
  return [...batches].map(([phoneNumberId, batch]) => ({
    phoneNumberId,
    ...batch,
  }));
}

// ---------------------------------------------------------------------------
// Graph API
// ---------------------------------------------------------------------------

export type MetaDeps = Readonly<{ fetch?: ChannelFetch; graph?: string }>;

async function graphCall(
  path: string,
  init: Readonly<{
    method: "GET" | "POST";
    token?: string;
    body?: unknown;
    query?: Record<string, string>;
  }>,
  deps: MetaDeps,
): Promise<Record<string, unknown>> {
  const url = new URL(`${deps.graph ?? metaGraphBase()}/${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const answer = await providerJson(
    url.toString(),
    {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    },
    deps,
  );
  return record(answer);
}

export type MetaNumber = Readonly<{
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}>;

/** The number as Meta sees it: the health check of a connection. */
export async function checkMetaNumber(
  phoneNumberId: string,
  token: string,
  deps: MetaDeps = {},
): Promise<MetaNumber> {
  const answer = await graphCall(
    phoneNumberId,
    {
      method: "GET",
      token,
      query: { fields: "display_phone_number,verified_name" },
    },
    deps,
  );
  return {
    displayPhoneNumber: str(answer.display_phone_number)?.slice(0, 40) ?? null,
    verifiedName: str(answer.verified_name)?.slice(0, 200) ?? null,
  };
}

/** The GUIDU app on the business account, so its webhooks come. */
export async function subscribeMetaApp(
  wabaId: string,
  token: string,
  deps: MetaDeps = {},
): Promise<void> {
  await graphCall(`${wabaId}/subscribed_apps`, { method: "POST", token }, deps);
}

/** The Embedded Signup's code, exchanged for the business's token. */
export async function exchangeMetaCode(
  code: string,
  app: Pick<MetaApp, "appId" | "appSecret">,
  deps: MetaDeps = {},
): Promise<string> {
  if (!app.appId || !app.appSecret) {
    throw new ChannelHttpError("unauthorized");
  }
  const answer = await graphCall(
    "oauth/access_token",
    {
      method: "GET",
      query: {
        client_id: app.appId,
        client_secret: app.appSecret,
        code,
      },
    },
    deps,
  );
  const token = str(answer.access_token);
  if (!token) throw new ChannelHttpError("invalid_response");
  return token;
}

/** A number not yet on the Cloud API, with its two-step PIN. */
export async function registerMetaNumber(
  phoneNumberId: string,
  token: string,
  pin: string,
  deps: MetaDeps = {},
): Promise<void> {
  await graphCall(
    `${phoneNumberId}/register`,
    { method: "POST", token, body: { messaging_product: "whatsapp", pin } },
    deps,
  );
}

function messageId(answer: Record<string, unknown>): string {
  const id = str(record(list(answer.messages)[0]).id);
  if (!id) throw new ChannelHttpError("invalid_response");
  return id.slice(0, 200);
}

/** Free text to a contact (within the window); returns Meta's id. */
export async function sendMetaText(
  phoneNumberId: string,
  token: string,
  to: string,
  body: string,
  deps: MetaDeps = {},
): Promise<string> {
  return messageId(
    await graphCall(
      `${phoneNumberId}/messages`,
      {
        method: "POST",
        token,
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: body.slice(0, MAX_META_TEXT), preview_url: true },
        },
      },
      deps,
    ),
  );
}

/** An approved template, with its variables in text. */
export async function sendMetaTemplate(
  phoneNumberId: string,
  token: string,
  to: string,
  template: Readonly<{
    name: string;
    language: string;
    variables: readonly string[];
  }>,
  deps: MetaDeps = {},
): Promise<string> {
  return messageId(
    await graphCall(
      `${phoneNumberId}/messages`,
      {
        method: "POST",
        token,
        body: {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.language },
            ...(template.variables.length > 0
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: template.variables.map((text) => ({
                        type: "text",
                        text,
                      })),
                    },
                  ],
                }
              : {}),
          },
        },
      },
      deps,
    ),
  );
}

export type MetaTemplate = Readonly<{
  name: string;
  language: string;
  category: string | null;
  /** The body, with its variables as {{1}}, {{2}}… */
  body: string;
  variables: number;
}>;

/** The approved templates of the business account. */
export async function listMetaTemplates(
  wabaId: string,
  token: string,
  deps: MetaDeps = {},
): Promise<MetaTemplate[]> {
  const answer = await graphCall(
    `${wabaId}/message_templates`,
    {
      method: "GET",
      token,
      query: {
        status: "APPROVED",
        fields: "name,language,category,components",
        limit: "100",
      },
    },
    deps,
  );
  const out: MetaTemplate[] = [];
  for (const raw of list(answer.data)) {
    const template = record(raw);
    const name = str(template.name);
    const language = str(template.language);
    if (!name || !language) continue;
    const body =
      str(
        record(
          list(template.components).find(
            (c) => record(c).type === "BODY",
          ),
        ).text,
      ) ?? "";
    out.push({
      name: name.slice(0, 512),
      language: language.slice(0, 20),
      category: str(template.category),
      body: body.slice(0, 1024),
      variables: new Set(body.match(/\{\{\d+\}\}/g) ?? []).size,
    });
  }
  return out;
}

/** A file a contact sent, by its id (link first, then the bytes). */
export async function downloadMetaMedia(
  url: string,
  token: string,
  deps: MetaDeps & Readonly<{ maxBytes?: number }> = {},
): Promise<Readonly<{ data: Buffer; mediaType: string | null }>> {
  const graph = deps.graph ?? metaGraphBase();
  if (!url.startsWith(`${graph}/`)) throw new ChannelHttpError("invalid_url");
  const info = await graphCall(
    url.slice(graph.length + 1),
    { method: "GET", token },
    deps,
  );
  const link = str(info.url);
  if (!link) throw new ChannelHttpError("invalid_response");
  return authorizedDownload(
    link,
    { authorization: `Bearer ${token}` },
    {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      maxBytes: deps.maxBytes ?? MAX_META_MEDIA_BYTES,
    },
  );
}
