import type { MatrixClient, NotificationCountType, Room } from "matrix-js-sdk";

import { CONVERSATION_STATE } from "./use-inbox-matrix";

/**
 * What the window reads from a room of the attendant's Matrix client
 * (IN4a). Only text messages are shown: a consumer may send events of any
 * type, and the console shows only the ones it knows (prova-de-conceito.md
 * §9). The order is the SDK timeline's, never the order of arrival.
 */

export type TimelineMessage = Readonly<{
  id: string;
  sender: string;
  senderName: string;
  body: string;
  ts: number;
  mine: boolean;
  /**
   * GF2: the specialist that wrote this answer under the orchestrator's name
   * (a mark of the event, honoured only when a GUIDS sent it).
   */
  answeredBy?: "attendant" | "seller";
}>;

/** Users of the GUIDS: `@_guidu_a_` and 16 base32 characters. */
const AGENT_USER = /^@_guidu_a_[a-z2-7]{16}:/;

/** Key of the mark in the event content (`core/matrix/agent.ts`). */
const ANSWERED_BY = "io.guidu.answered_by";

/**
 * Who answered, from the mark of an event: only when the sender is a GUIDS
 * (a contact could write the same key) and the value is a known role.
 */
export function answeredByOf(
  sender: string,
  content: Record<string, unknown>,
): "attendant" | "seller" | undefined {
  const value = content[ANSWERED_BY];
  return AGENT_USER.test(sender) && (value === "attendant" || value === "seller")
    ? value
    : undefined;
}

/** Accounts of attendants: `@u_` and 24 base32 characters. */
const ATTENDANT = /^@u_[a-z2-7]{24}:/;

/** Power of who answers in a room (synapse.ts, REPLY_POWER). */
const REPLY_POWER = 10;

function isText(type: string, content: Record<string, unknown>): boolean {
  return (
    type === "m.room.message" &&
    typeof content.body === "string" &&
    (content.msgtype === "m.text" ||
      content.msgtype === "m.notice" ||
      content.msgtype === "m.emote")
  );
}

export function timeline(
  room: Room | null,
  me: string | null,
): TimelineMessage[] {
  if (!room) return [];
  return room
    .getLiveTimeline()
    .getEvents()
    .filter((event) => isText(event.getType(), event.getContent()))
    .map((event) => {
      const sender = event.getSender() ?? "";
      const answeredBy = answeredByOf(sender, event.getContent());
      return {
        id: event.getId() ?? `${sender}-${event.getTs()}`,
        sender,
        senderName: room.getMember(sender)?.name ?? sender,
        body: String(event.getContent().body ?? ""),
        ts: event.getTs(),
        mine: sender === me,
        ...(answeredBy ? { answeredBy } : {}),
      };
    });
}

export function lastMessage(
  room: Room | null,
): Readonly<{ body: string; ts: number }> | null {
  if (!room) return null;
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (isText(event.getType(), event.getContent())) {
      return { body: String(event.getContent().body ?? ""), ts: event.getTs() };
    }
  }
  return null;
}

export type RoomConversation = Readonly<{
  status: "open" | "pending" | "resolved";
  assignee: string | null;
}>;

/** The conversation state held by the room, when the client has it. */
export function roomConversation(room: Room | null): RoomConversation | null {
  const event = room?.currentState.getStateEvents(CONVERSATION_STATE, "");
  if (!event) return null;
  const content = event.getContent() as {
    status?: unknown;
    assignee?: unknown;
  };
  const status =
    content.status === "open" ||
    content.status === "pending" ||
    content.status === "resolved"
      ? content.status
      : "pending";
  return {
    status,
    assignee: typeof content.assignee === "string" ? content.assignee : null,
  };
}

/** Names of who is typing in the room, other than me. */
export function typingNames(room: Room | null, me: string | null): string[] {
  if (!room) return [];
  return room
    .getMembers()
    .filter((member) => member.typing && member.userId !== me)
    .map((member) => member.name);
}

export type Candidate = Readonly<{ mxid: string; name: string }>;

/** Attendants who answer in the room, for the assignment. */
export function replyAttendants(room: Room | null): Candidate[] {
  if (!room) return [];
  const power = room.currentState.getStateEvents("m.room.power_levels", "");
  const users = (power?.getContent().users ?? {}) as Record<string, unknown>;
  return Object.entries(users)
    .filter(([mxid, level]) => level === REPLY_POWER && ATTENDANT.test(mxid))
    .map(([mxid]) => ({
      mxid,
      name: room.getMember(mxid)?.name ?? mxid,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Display name of someone in a room, or null. */
export function memberName(
  room: Room | null,
  mxid: string | null,
): string | null {
  if (!room || !mxid) return null;
  const member = room.getMember(mxid);
  return member && member.name !== mxid ? member.name : null;
}

export function getRoom(
  client: MatrixClient | null,
  roomId: string | null,
): Room | null {
  return client && roomId ? client.getRoom(roomId) : null;
}

/** Messages of a room the attendant has not read (Matrix receipts, IN4b). */
export function unreadCount(room: Room | null, me: string | null): number {
  if (!room) return 0;
  // `NotificationCountType.Total`, without loading the SDK on the server.
  const server =
    room.getUnreadNotificationCount("total" as NotificationCountType) ?? 0;
  // Synapse counts only by push rules; the loaded timeline after the
  // attendant's own receipt (or own message) counts too.
  let local = 0;
  if (me) {
    const events = room.getLiveTimeline().getEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      const id = event.getId();
      if (
        event.getSender() === me ||
        (id && room.hasUserReadEvent(me, id))
      ) {
        break;
      }
      if (isText(event.getType(), event.getContent())) local += 1;
    }
  }
  return Math.max(0, server, local);
}
