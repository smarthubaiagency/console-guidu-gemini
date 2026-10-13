import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { InboundEvent } from "@/core/channels/contract";

import {
  groupedAttachments,
  groupedText,
  handoffNote,
} from "./channel-consumer";

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

const audio = {
  kind: "audio" as const,
  url: "https://chat.example.com/a.ogg",
  mimeType: "audio/ogg",
  size: null,
};

describe("groupedText", () => {
  it("joins the text of the contact's messages", () => {
    expect(
      groupedText([event("Olá"), event("", [audio]), event("Quero o preço")]),
    ).toBe("Olá\nQuero o preço");
  });
});

describe("groupedAttachments", () => {
  it("loads each file through the core", async () => {
    const loadAttachment = vi.fn(async () => ({
      data: new Uint8Array([1]),
      mediaType: "audio/ogg",
    }));
    const files = groupedAttachments({
      events: [event("Olá"), event("", [audio])],
      loadAttachment,
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: "audio", mimeType: "audio/ogg" });
    await files[0]!.load(1000);
    expect(loadAttachment).toHaveBeenCalledWith(audio, 1000);
  });
});

describe("handoffNote", () => {
  it("writes the summary for the team in the agent's language", () => {
    expect(
      handoffNote("pt-BR", "Ana", {
        reason: "Pediu uma pessoa.",
        summary: "Maria quer 10 unidades.",
      }),
    ).toBe(
      "Resumo de Ana para a equipe\n\nMaria quer 10 unidades.\n\nMotivo da transferência: Pediu uma pessoa.",
    );
    expect(
      handoffNote("en-US", "Ana", { reason: "Asked.", summary: "Wants 10." }),
    ).toContain("Summary from Ana for the team");
  });
});
