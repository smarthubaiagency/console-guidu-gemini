import { describe, expect, it } from "vitest";

import { type InboxActor, nextConversationState } from "./conversation";

const ana = "@u_aaaaaaaaaaaaaaaaaaaaaaaa:hs.test";
const bia = "@u_bbbbbbbbbbbbbbbbbbbbbbbb:hs.test";

const answers: InboxActor = { mxid: ana, level: "reply", manages: false };
const reader: InboxActor = { mxid: ana, level: "read", manages: true };
const lead: InboxActor = { mxid: ana, level: "reply", manages: true };

describe("changes of the conversation (IN4a)", () => {
  it("lets who answers take a conversation with nobody, not someone else's", () => {
    expect(
      nextConversationState(
        { status: "pending", assignee: null },
        { kind: "take" },
        answers,
      ),
    ).toEqual({ status: "open", assignee: ana });
    expect(() =>
      nextConversationState(
        { status: "open", assignee: bia },
        { kind: "take" },
        answers,
      ),
    ).toThrow(expect.objectContaining({ code: "conflict" }));
    // A manager who answers may take it.
    expect(
      nextConversationState(
        { status: "open", assignee: bia },
        { kind: "take" },
        lead,
      ),
    ).toEqual({ status: "open", assignee: ana });
  });

  it("lets any attendant resolve and reopen; who only reads does neither", () => {
    expect(
      nextConversationState(
        { status: "open", assignee: bia },
        { kind: "resolve" },
        answers,
      ),
    ).toEqual({ status: "resolved", assignee: bia });
    expect(
      nextConversationState(
        { status: "resolved", assignee: null },
        { kind: "reopen" },
        answers,
      ),
    ).toEqual({ status: "open", assignee: ana });
    expect(() =>
      nextConversationState(
        { status: "open", assignee: null },
        { kind: "reopen" },
        answers,
      ),
    ).toThrow(expect.objectContaining({ code: "conflict" }));
    for (const kind of ["take", "resolve", "reopen"] as const) {
      expect(() =>
        nextConversationState(
          { status: "resolved", assignee: null },
          { kind },
          reader,
        ),
      ).toThrow(expect.objectContaining({ code: "forbidden" }));
    }
  });

  it("lets only a manager assign, even one who only reads", () => {
    expect(
      nextConversationState(
        { status: "pending", assignee: null },
        { kind: "assign", assignee: bia },
        reader,
      ),
    ).toEqual({ status: "open", assignee: bia });
    expect(
      nextConversationState(
        { status: "open", assignee: bia },
        { kind: "assign", assignee: null },
        reader,
      ),
    ).toEqual({ status: "pending", assignee: null });
    expect(() =>
      nextConversationState(
        { status: "pending", assignee: null },
        { kind: "assign", assignee: bia },
        answers,
      ),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
  });

  it("lets who answers give the conversation back to the GUIDS (IN6)", () => {
    expect(
      nextConversationState(
        { status: "open", assignee: bia },
        { kind: "return" },
        answers,
      ),
    ).toEqual({ status: "pending", assignee: null });
    expect(
      nextConversationState(
        { status: "resolved", assignee: null },
        { kind: "return" },
        answers,
      ),
    ).toEqual({ status: "pending", assignee: null });
    expect(() =>
      nextConversationState(
        { status: "pending", assignee: null },
        { kind: "return" },
        answers,
      ),
    ).toThrow(expect.objectContaining({ code: "conflict" }));
    expect(() =>
      nextConversationState(
        { status: "open", assignee: null },
        { kind: "return" },
        reader,
      ),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
  });
});
