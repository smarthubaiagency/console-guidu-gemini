import { describe, expect, it } from "vitest";

import type { InboxNoteView } from "../server/notes";
import type { TimelineMessage } from "./room-data";
import { mergeTimeline } from "./timeline";

const message = (id: string, ts: number): TimelineMessage => ({
  id,
  sender: "@c:matrix.test",
  senderName: "Maria",
  body: `mensagem ${id}`,
  ts,
  mine: false,
});

const note = (id: string, ts: number): InboxNoteView => ({
  id,
  roomId: "!r",
  authorId: "u1",
  authorName: "Ana",
  body: `nota ${id}`,
  createdAt: new Date(ts).toISOString(),
  editedAt: null,
  deleted: false,
  mine: true,
});

describe("mergeTimeline (IN5a)", () => {
  it("puts the notes among the messages by date", () => {
    const items = mergeTimeline(
      [message("a", 1_000), message("b", 3_000), message("c", 5_000)],
      [note("x", 2_000), note("y", 6_000)],
    );
    expect(items.map((item) => item.key)).toEqual([
      "m:a",
      "n:x",
      "m:b",
      "m:c",
      "n:y",
    ]);
  });

  it("keeps the message first at the same instant, and each list's order", () => {
    const items = mergeTimeline(
      [message("a", 1_000), message("b", 1_000)],
      [note("x", 1_000), note("y", 1_000)],
    );
    expect(items.map((item) => item.key)).toEqual(["m:a", "m:b", "n:x", "n:y"]);
  });

  it("works with only messages, only notes or nothing", () => {
    expect(mergeTimeline([], [])).toEqual([]);
    expect(mergeTimeline([message("a", 1)], []).map((i) => i.kind)).toEqual([
      "message",
    ]);
    const only = mergeTimeline([], [note("x", 10), note("y", 5)]);
    expect(only.map((item) => item.key)).toEqual(["n:y", "n:x"]);
    expect(only[0]).toMatchObject({ kind: "note", ts: 5 });
  });
});
