import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkChatwoot,
  createAgentBot,
  isTrigger,
  normalizeChatwoot,
} from "./chatwoot";
import { InboundEvent } from "./contract";

/**
 * Conformance of the Chatwoot adapter (A5a): the Agent Bot webhook
 * payloads become events of the contract, only a public incoming message
 * of a contact is a trigger, and the account API calls carry the token in
 * the header and fail with a code, never the provider's body.
 */

const contact = {
  id: 9,
  name: "Maria",
  type: "contact",
  phone_number: "+5511999990000",
  email: "maria@example.com",
};

function messageCreated(overrides: Record<string, unknown> = {}) {
  return {
    event: "message_created",
    id: 1201,
    content: "Olá, quero um orçamento",
    message_type: "incoming",
    content_type: "text",
    private: false,
    created_at: "2026-10-13T12:00:00.000Z",
    sender: contact,
    conversation: {
      id: 55,
      inbox_id: 3,
      status: "pending",
      contact_inbox: { contact_id: 9 },
      meta: { sender: contact },
    },
    inbox: { id: 3, name: "WhatsApp" },
    account: { id: 1, name: "Loja" },
    attachments: [],
    ...overrides,
  };
}

describe("normalizeChatwoot", () => {
  it("turns an incoming message into a trigger of the contract", () => {
    const [event] = normalizeChatwoot(messageCreated());
    expect(InboundEvent.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      contractVersion: 1,
      externalId: "message:1201",
      kind: "message",
      sender: "contact",
      scope: "3",
      occurredAt: "2026-10-13T12:00:00.000Z",
      conversation: { externalId: "55", contactId: "9", status: "pending" },
      contact: { externalId: "9", name: "Maria", phone: "+5511999990000" },
      message: { text: "Olá, quero um orçamento", private: false },
    });
    expect(isTrigger(event!)).toBe(true);
  });

  it("keeps team, bot and private messages as context only", () => {
    const agent = normalizeChatwoot(
      messageCreated({
        id: 2,
        message_type: "outgoing",
        sender: { id: 4, name: "Ana", type: "user" },
      }),
    )[0]!;
    const bot = normalizeChatwoot(
      messageCreated({
        id: 3,
        message_type: 1,
        sender: { id: 7, name: "GUIDU", type: "agent_bot" },
      }),
    )[0]!;
    const note = normalizeChatwoot(
      messageCreated({ id: 4, private: true }),
    )[0]!;
    const empty = normalizeChatwoot(
      messageCreated({ id: 5, content: " " }),
    )[0]!;
    expect([agent.sender, bot.sender]).toEqual(["agent", "bot"]);
    // The contact of the conversation still comes along.
    expect(agent.contact?.externalId).toBe("9");
    expect([agent, bot, note, empty].map(isTrigger)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("keeps http attachments and drops anything else", () => {
    const [event] = normalizeChatwoot(
      messageCreated({
        content: null,
        attachments: [
          {
            file_type: "audio",
            data_url: "https://chat.example.com/a.ogg",
            file_size: 1234,
          },
          { file_type: "image", data_url: "javascript:alert(1)" },
        ],
      }),
    );
    expect(event?.message?.attachments).toEqual([
      {
        kind: "audio",
        url: "https://chat.example.com/a.ogg",
        mimeType: null,
        size: 1234,
      },
    ]);
    expect(isTrigger(event!)).toBe(true);
  });

  it("reads a status change with a key per change", () => {
    const [event] = normalizeChatwoot({
      event: "conversation_status_changed",
      id: 55,
      status: "open",
      inbox_id: 3,
      updated_at: 1_760_356_800,
      contact_inbox: { contact_id: 9 },
      meta: { sender: contact },
    });
    expect(event).toMatchObject({
      externalId: "status:55:open:2025-10-13T12:00:00.000Z",
      kind: "conversation_status",
      sender: "system",
      scope: "3",
      conversation: { externalId: "55", status: "open" },
      message: null,
    });
    expect(isTrigger(event!)).toBe(false);
  });

  it("ignores unknown events, payloads without an inbox and out-of-contract data", () => {
    expect(normalizeChatwoot({ event: "webwidget_triggered" })).toEqual([]);
    expect(normalizeChatwoot("nada")).toEqual([]);
    expect(
      normalizeChatwoot(
        messageCreated({
          inbox: null,
          conversation: { id: 55, status: "open" },
        }),
      ),
    ).toEqual([]);
    expect(normalizeChatwoot(messageCreated({ id: "x".repeat(300) }))).toEqual(
      [],
    );
  });

  it("truncates long texts and caps the events of one call", () => {
    const [long] = normalizeChatwoot(
      messageCreated({ content: "a".repeat(30_000) }),
    );
    expect(long?.message?.text).toHaveLength(20_000);
    const many = Array.from({ length: 80 }, (_, index) =>
      messageCreated({ id: index + 1 }),
    );
    expect(normalizeChatwoot(many)).toHaveLength(50);
  });
});

describe("Chatwoot account API", () => {
  const account = { baseUrl: "https://203.0.113.10", accountId: 1 };

  it("creates the Agent Bot with the token in the header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ id: 7, access_token: "bot-token-123456" }),
    );
    await expect(
      createAgentBot(
        account,
        "user-token-123",
        { name: "GUIDU · A", outgoingUrl: "https://app.test/api/channels/x/y" },
        { fetch },
      ),
    ).resolves.toEqual({ id: 7, accessToken: "bot-token-123456" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://203.0.113.10/api/v1/accounts/1/agent_bots",
    );
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).api_access_token).toBe(
      "user-token-123",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      outgoing_url: "https://app.test/api/channels/x/y",
    });
  });

  it("reports why a check failed", async () => {
    const secrets = { userToken: "user-token-123", botToken: "bot-token-123" };
    const inboxes = Response.json({
      payload: [{ id: 3, name: "WhatsApp", channel_type: "Channel::Api" }],
    });
    await expect(
      checkChatwoot(account, secrets, 7, {
        fetch: vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValueOnce(inboxes.clone())
          .mockResolvedValueOnce(Response.json({ id: 7 })),
      }),
    ).resolves.toEqual({
      ok: true,
      code: null,
      inboxes: [{ id: 3, name: "WhatsApp", channel_type: "Channel::Api" }],
    });
    await expect(
      checkChatwoot(account, secrets, 7, {
        fetch: vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValueOnce(inboxes.clone())
          .mockResolvedValueOnce(new Response("gone", { status: 404 })),
      }),
    ).resolves.toMatchObject({ ok: false, code: "bot_missing" });
    await expect(
      checkChatwoot(account, secrets, 7, {
        fetch: vi.fn<typeof globalThis.fetch>(
          async () => new Response("token leaked?", { status: 401 }),
        ),
      }),
    ).resolves.toMatchObject({ ok: false, code: "unauthorized" });
    await expect(
      checkChatwoot(account, secrets, 7, {
        fetch: vi.fn<typeof globalThis.fetch>(
          async () => new Response("", { status: 404 }),
        ),
      }),
    ).resolves.toMatchObject({ ok: false, code: "account_missing" });
  });
});
