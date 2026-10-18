import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeMeta, verifyMetaSignature } from "./meta";

const GRAPH = "https://graph.facebook.com/v21.0";

function body(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "200", changes: [{ field: "messages", value }] }],
  };
}

describe("Meta adapter (IN7a)", () => {
  it("checks the app secret's signature on the raw body", () => {
    const raw = '{"a":1}';
    const good = createHmac("sha256", "secret").update(raw).digest("hex");
    expect(verifyMetaSignature(raw, `sha256=${good}`, "secret")).toBe(true);
    expect(verifyMetaSignature(raw, `sha256=${good}`, "other")).toBe(false);
    expect(verifyMetaSignature(`${raw} `, `sha256=${good}`, "secret")).toBe(
      false,
    );
    expect(verifyMetaSignature(raw, null, "secret")).toBe(false);
    expect(verifyMetaSignature(raw, "sha1=abc", "secret")).toBe(false);
  });

  it("normalizes a contact's text, with the profile name, by number", () => {
    const [batch] = normalizeMeta(
      body({
        metadata: { phone_number_id: "10001" },
        contacts: [{ profile: { name: "Maria" }, wa_id: "5511999990000" }],
        messages: [
          {
            from: "5511999990000",
            id: "wamid.A",
            timestamp: "1760000000",
            type: "text",
            text: { body: "Oi" },
          },
        ],
      }),
      GRAPH,
    );
    expect(batch?.phoneNumberId).toBe("10001");
    expect(batch?.events[0]).toMatchObject({
      externalId: "wamid.A",
      kind: "message",
      sender: "contact",
      scope: "10001",
      occurredAt: new Date(1760000000 * 1000).toISOString(),
      conversation: { externalId: "5511999990000" },
      contact: { name: "Maria", phone: "5511999990000" },
      message: { text: "Oi", attachments: [] },
    });
  });

  it("takes media by id, captions and replies to buttons", () => {
    const [batch] = normalizeMeta(
      body({
        metadata: { phone_number_id: "10001" },
        messages: [
          {
            from: "5511999990000",
            id: "wamid.B",
            timestamp: "1760000000",
            type: "document",
            document: {
              id: "777777",
              mime_type: "application/pdf",
              caption: "Nota",
            },
          },
          {
            from: "5511999990000",
            id: "wamid.C",
            timestamp: "1760000000",
            type: "interactive",
            interactive: { button_reply: { id: "b1", title: "Sim" } },
          },
        ],
      }),
      GRAPH,
    );
    expect(batch?.events[0]?.message).toMatchObject({
      text: "Nota",
      attachments: [
        { kind: "file", url: `${GRAPH}/777777`, mimeType: "application/pdf" },
      ],
    });
    expect(batch?.events[1]?.message?.text).toBe("Sim");
  });

  it("keeps only the failed statuses' code, and ignores other objects", () => {
    const [batch] = normalizeMeta(
      body({
        metadata: { phone_number_id: "10001" },
        statuses: [
          { id: "wamid.X", status: "delivered" },
          { id: "wamid.Y", status: "failed", errors: [{ code: 131047 }] },
          { id: "wamid.Z", status: "weird" },
        ],
      }),
      GRAPH,
    );
    expect(batch?.statuses).toEqual([
      { externalId: "wamid.X", status: "delivered", error: null },
      { externalId: "wamid.Y", status: "failed", error: "meta_131047" },
    ]);
    expect(normalizeMeta({ object: "page", entry: [] })).toEqual([]);
    expect(
      normalizeMeta(body({ metadata: { phone_number_id: "x" }, messages: [] })),
    ).toEqual([]);
  });
});
