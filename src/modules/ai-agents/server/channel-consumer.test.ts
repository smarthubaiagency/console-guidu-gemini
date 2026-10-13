import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { InboundEvent } from "@/core/channels/contract";

import { groupedText } from "./channel-consumer";

const event = (
  text: string,
  attachments: InboundEvent["message"] extends infer M
    ? M extends { attachments: infer A }
      ? A
      : never
    : never = [],
): InboundEvent => ({
  contractVersion: 1,
  externalId: `message:${text}`,
  kind: "message",
  sender: "contact",
  scope: "3",
  occurredAt: null,
  conversation: { externalId: "55", contactId: null, status: "pending" },
  contact: null,
  message: { text, private: false, attachments },
});

describe("groupedText", () => {
  it("joins the contact's messages and notes what was attached", () => {
    expect(
      groupedText([
        event("Olá"),
        event("", [
          {
            kind: "audio",
            url: "https://chat.example.com/a.ogg",
            mimeType: null,
            size: null,
          },
        ]),
        event("Quero o preço"),
      ]),
    ).toBe("Olá\n[O contato enviou um áudio]\nQuero o preço");
  });
});
