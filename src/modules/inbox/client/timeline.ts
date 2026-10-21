import type { InboxNoteView } from "../server/notes";
import type { TimelineMessage } from "./room-data";

/**
 * The timeline of the open conversation (IN5a): the messages of the room
 * (Matrix) and the private notes of the team (database), by date. A note
 * and a message at the same instant keep the message first; each list
 * keeps its own order.
 */
export type TimelineItem =
  | Readonly<{
      kind: "message";
      key: string;
      ts: number;
      message: TimelineMessage;
    }>
  | Readonly<{ kind: "note"; key: string; ts: number; note: InboxNoteView }>;

export function mergeTimeline(
  messages: readonly TimelineMessage[],
  notes: readonly InboxNoteView[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map(
      (message) =>
        ({
          kind: "message",
          key: `m:${message.id}`,
          ts: message.ts,
          message,
        }) as const,
    ),
    ...notes.map(
      (note) =>
        ({
          kind: "note",
          key: `n:${note.id}`,
          ts: Date.parse(note.createdAt),
          note,
        }) as const,
    ),
  ];
  // Array.prototype.sort is stable: equal dates keep messages, then notes.
  return items.sort((a, b) => a.ts - b.ts);
}
