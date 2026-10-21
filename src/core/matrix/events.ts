import type { ContextTransaction } from "@/lib/prisma/with-context";

import { upsertMember } from "./accounts";
import { openConsumerRoom, workspaceOfAddress } from "./addresses";
import { onConsumerMessage } from "./agent";
import { enqueueMetaSend } from "./meta";
import { coreUserId, isNamespaceUser } from "./config";
import { ATTENDANT_LOCALPART } from "./jwt";
import { detectContactLocale, isContactLocale } from "./locale";
import { runRoomAssigned, runRoomHandedOff } from "./room-hooks";
import {
  CONVERSATION_STATE,
  CONVERSATION_STATUSES,
  type ConversationStatus,
  leaveAs,
  roomCreator,
  type SynapseClient,
} from "./synapse";

/**
 * What the core keeps of a transaction of the Application Service (IN3).
 * The route reduces each event to the few fields processing reads, and
 * drops every other type: the messages stay in Synapse (ADR 0023, rule 6).
 * A message is kept only as a mark (IN4b): who sent it, when, and its
 * kind, never the text; with TR1, also the language guessed from it.
 */

export type ReducedEvent = Readonly<{
  event_id: string;
  room_id: string;
  type: "m.room.member" | typeof CONVERSATION_STATE | "m.room.message";
  state_key: string | null;
  sender: string;
  origin_server_ts: number | null;
  content: Record<string, string | null>;
}>;

const MEMBERSHIPS = new Set(["invite", "join", "leave", "ban", "knock"]);

function text(value: unknown, max = 255): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

const TEXT_TYPES = ["m.text", "m.notice", "m.emote"];

/**
 * TR1: the language of a text message, guessed here, in memory, as the
 * event arrives; only the guess is kept (`locale`, `locale_confidence`),
 * never the text.
 */
function localeOf(content: Record<string, unknown>): Record<string, string> {
  if (
    typeof content.body !== "string" ||
    !TEXT_TYPES.includes(String(content.msgtype))
  ) {
    return {};
  }
  const guess = detectContactLocale(content.body.slice(0, 4000));
  return guess
    ? { locale: guess.locale, locale_confidence: String(guess.confidence) }
    : {};
}

export function reduceEvent(raw: unknown): ReducedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  const eventId = text(event.event_id);
  const roomId = text(event.room_id);
  const sender = text(event.sender);
  const content =
    event.content && typeof event.content === "object"
      ? (event.content as Record<string, unknown>)
      : null;
  const ts =
    typeof event.origin_server_ts === "number"
      ? Math.trunc(event.origin_server_ts)
      : null;
  if (
    event.type === "m.room.message" &&
    eventId &&
    roomId &&
    sender &&
    content
  ) {
    return {
      event_id: eventId,
      room_id: roomId,
      type: "m.room.message",
      state_key: null,
      sender,
      origin_server_ts: ts,
      content: { msgtype: text(content.msgtype, 40), ...localeOf(content) },
    };
  }
  if (
    !eventId ||
    !roomId ||
    !sender ||
    !content ||
    typeof event.state_key !== "string"
  )
    return null;
  if (event.type === "m.room.member") {
    const stateKey = text(event.state_key);
    const membership = text(content.membership, 16);
    if (!stateKey || !membership || !MEMBERSHIPS.has(membership)) return null;
    // The display name names the consumer in the search (IN4a).
    const name = text(content.displayname, 255);
    return {
      event_id: eventId,
      room_id: roomId,
      type: "m.room.member",
      state_key: stateKey,
      sender,
      origin_server_ts: ts,
      content: name ? { membership, displayname: name } : { membership },
    };
  }
  if (event.type === CONVERSATION_STATE && event.state_key === "") {
    return {
      event_id: eventId,
      room_id: roomId,
      type: CONVERSATION_STATE,
      state_key: "",
      sender,
      origin_server_ts: ts,
      content: {
        status: text(content.status, 20),
        assignee: content.assignee === null ? null : text(content.assignee),
        // Who made the change through the console (IN4b): an assignment by
        // someone else tells the assignee.
        by: text(content.by),
      },
    };
  }
  return null;
}

/**
 * Who may open a conversation by calling the address of a store: anyone
 * but the core's own users (the namespace and the attendants' accounts).
 */
function isConsumer(client: SynapseClient, mxid: string): boolean {
  if (isNamespaceUser(client.config, mxid)) return false;
  const local = /^@([^:]+):(.+)$/.exec(mxid);
  if (!local?.[1]) return false;
  return !(
    local[2] === client.config.serverName && ATTENDANT_LOCALPART.test(local[1])
  );
}

export type MessageSide = "consumer" | "team" | "agent";

/**
 * Who sent a message (IN4b): the room's consumer, a person of the team
 * (an attendant's account) or an agent (a user of the namespace other than
 * the core and the addresses). Anyone else is not counted.
 */
export function messageSide(
  client: SynapseClient,
  sender: string,
  consumerMxid: string | null,
): MessageSide | null {
  if (consumerMxid && sender === consumerMxid) return "consumer";
  const local = /^@([^:]+):(.+)$/.exec(sender);
  if (!local?.[1] || local[2] !== client.config.serverName) return null;
  if (ATTENDANT_LOCALPART.test(local[1])) return "team";
  if (/^_guidu_a_/.test(local[1])) return "agent";
  return null;
}

/** Events of an unknown room wait this long for its row (creation race). */
const UNKNOWN_ROOM_WAIT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export type ProcessResult = Readonly<{
  processed: number;
  ignored: number;
  refused: number;
  waiting: number;
  failed: number;
  more: boolean;
}>;

type Outcome = "processed" | "ignored" | "refused" | "waiting";

function isConversationStatus(value: unknown): value is ConversationStatus {
  return (CONVERSATION_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Processes the pending events, oldest first (job `matrix.process-events`):
 * - membership in a known room is followed in `matrix_room_members`;
 * - the conversation state is mirrored in `matrix_rooms` (newest wins);
 * - an invite of a namespace user to a room the core does not know (a room
 *   a consumer created) is refused: in it the consumer would be the owner,
 *   able to turn encryption on and change the power levels. When the user
 *   is the address of a workspace (IN4a), the core opens a room of its own
 *   for that consumer (or reuses their open one).
 */
export async function processPendingEvents(
  tx: ContextTransaction,
  client: SynapseClient,
  now: Date = new Date(),
  batch = 200,
): Promise<ProcessResult> {
  const events = await tx.matrixEvent.findMany({
    where: { status: "pending" },
    orderBy: [{ receivedAt: "asc" }, { originServerTs: "asc" }],
    take: batch,
  });
  const counts = {
    processed: 0,
    ignored: 0,
    refused: 0,
    waiting: 0,
    failed: 0,
  };
  for (const event of events) {
    let outcome: Outcome;
    try {
      outcome = await handleEvent(tx, client, event, now);
    } catch (error) {
      const attempts = event.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await tx.matrixEvent.update({
        where: { eventId: event.eventId },
        data: {
          attempts,
          status: failed ? "failed" : "pending",
          lastError: (error instanceof Error ? error.message : "error").slice(
            0,
            300,
          ),
          ...(failed ? { processedAt: now } : {}),
        },
      });
      if (failed) counts.failed += 1;
      else counts.waiting += 1;
      continue;
    }
    if (outcome === "waiting") {
      counts.waiting += 1;
      continue;
    }
    counts[outcome] += 1;
    await tx.matrixEvent.update({
      where: { eventId: event.eventId },
      data: {
        status: outcome === "ignored" ? "ignored" : "processed",
        processedAt: now,
      },
    });
  }
  return {
    ...counts,
    more: events.length === batch && counts.waiting < events.length,
  };
}

type StoredEvent = Readonly<{
  eventId: string;
  roomId: string;
  type: string;
  stateKey: string | null;
  sender: string;
  content: unknown;
  originServerTs: bigint | null;
  receivedAt: Date;
}>;

async function handleEvent(
  tx: ContextTransaction,
  client: SynapseClient,
  event: StoredEvent,
  now: Date,
): Promise<Outcome> {
  const content = (event.content ?? {}) as Record<string, unknown>;
  const room = await tx.matrixRoom.findUnique({
    where: { roomId: event.roomId },
    select: {
      id: true,
      workspaceId: true,
      organizationId: true,
      statusEventTs: true,
      state: true,
      status: true,
      consumerMxid: true,
      consumerName: true,
      assignee: true,
      channelConversationId: true,
    },
  });

  if (!room) {
    const target = event.stateKey ?? "";
    if (
      event.type === "m.room.member" &&
      content.membership === "invite" &&
      isNamespaceUser(client.config, target) &&
      !isNamespaceUser(client.config, event.sender)
    ) {
      await leaveAs(
        client,
        event.roomId,
        target,
        "O atendimento abre uma sala própria.",
      );
      const workspaceId = await workspaceOfAddress(tx, target);
      if (workspaceId && isConsumer(client, event.sender)) {
        await openConsumerRoom(tx, client, {
          workspaceId,
          consumerMxid: event.sender,
        });
      }
      return "refused";
    }
    // Only a room the core created can still get its row (creation race);
    // any other (a consumer's own room) is ignored at once (IN4a).
    if (
      (await roomCreator(client, event.roomId)) !== coreUserId(client.config)
    ) {
      return "ignored";
    }
    return now.getTime() - event.receivedAt.getTime() < UNKNOWN_ROOM_WAIT_MS
      ? "waiting"
      : "ignored";
  }

  if (event.type === "m.room.member") {
    if (!event.stateKey || typeof content.membership !== "string")
      return "ignored";
    await upsertMember(
      tx,
      {
        roomId: event.roomId,
        workspaceId: room.workspaceId,
        organizationId: room.organizationId,
      },
      event.stateKey,
      content.membership,
      event.originServerTs,
    );
    if (typeof content.displayname === "string" && content.displayname) {
      await tx.$executeRaw`
        update public.matrix_rooms set consumer_name = ${content.displayname.slice(0, 255)}
        where id = ${room.id}::uuid and consumer_mxid = ${event.stateKey}
          and consumer_name is distinct from ${content.displayname.slice(0, 255)}
      `;
    }
    return "processed";
  }

  if (event.type === "m.room.message") {
    const side = messageSide(client, event.sender, room.consumerMxid);
    if (!side) return "ignored";
    const at = new Date(
      event.originServerTs !== null
        ? Number(event.originServerTs)
        : now.getTime(),
    );
    // The newest mark wins; a retried or late event never moves it back.
    const column = {
      consumer: "last_consumer_message_at",
      team: "last_team_message_at",
      agent: "last_agent_message_at",
    }[side];
    await tx.$executeRawUnsafe(
      `update public.matrix_rooms set ${column} = $1
       where id = $2::uuid and (${column} is null or ${column} < $1)`,
      at,
      room.id,
    );
    // TR1: the contact's language, guessed as the event arrived (the text
    // never reaches the database). A language set by the team stays.
    const locale = isContactLocale(content.locale) ? content.locale : null;
    const confidence = Number(content.locale_confidence);
    if (
      side === "consumer" &&
      locale &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 1
    ) {
      await tx.$executeRaw`
        update public.matrix_rooms
        set contact_locale = ${locale},
            contact_locale_source = 'detected',
            contact_locale_confidence = ${confidence}::real
        where id = ${room.id}::uuid
          and contact_locale_source is distinct from 'manual'
          and (contact_locale is distinct from ${locale}
            or contact_locale_confidence is distinct from ${confidence}::real)
      `;
    }
    // TR2: a text of the contact or of the GUIDS in another language than
    // the team's is translated for the team (job with the room and the
    // event only; the database decides whether the translation is on).
    if (
      (side === "consumer" || side === "agent") &&
      room.state === "active" &&
      TEXT_TYPES.includes(String(content.msgtype))
    ) {
      await tx.$queryRaw`
        select private.inbox_translation_enqueue(${event.roomId}, ${event.eventId}, ${locale}::text) as run
      `;
    }
    // IN6: the GUIDS's turn, and a resolved conversation back to pending.
    if (side === "consumer" && room.state === "active") {
      await onConsumerMessage(
        tx,
        client,
        { ...room, roomId: event.roomId },
        event.originServerTs,
      );
    }
    // IN7a: what the team or the GUIDS says in a room of a number goes out.
    if (
      (side === "team" || side === "agent") &&
      room.state === "active" &&
      room.channelConversationId &&
      TEXT_TYPES.includes(String(content.msgtype))
    ) {
      await enqueueMetaSend(tx, event.roomId, event.eventId);
    }
    return "processed";
  }

  if (event.type === CONVERSATION_STATE) {
    const assignee = content.assignee;
    if (!isConversationStatus(content.status)) return "ignored";
    if (
      assignee !== null &&
      (typeof assignee !== "string" || !/^@[^:]+:.+$/.test(assignee))
    ) {
      return "ignored";
    }
    const ts = event.originServerTs;
    const updated = await tx.$executeRaw`
      update public.matrix_rooms
      set status = ${content.status}, assignee = ${assignee as string | null},
          status_event_id = ${event.eventId}, status_event_ts = ${ts}
      where id = ${room.id}::uuid
        and (status_event_ts is null or ${ts}::bigint is null or status_event_ts <= ${ts}::bigint)
    `;
    if (updated === 0) return "ignored";
    const by = typeof content.by === "string" ? content.by : null;
    if (
      typeof assignee === "string" &&
      assignee !== room.assignee &&
      by !== null &&
      by !== assignee
    ) {
      await runRoomAssigned(
        tx,
        {
          roomId: event.roomId,
          workspaceId: room.workspaceId,
          consumerName: room.consumerName,
        },
        assignee,
        event.eventId,
      );
    }
    // Only the GUIDS's handoff takes a pending room to open without an
    // assignee, written by the core (no `by`): the team hears of it now.
    if (
      room.status === "pending" &&
      content.status === "open" &&
      assignee === null &&
      by === null
    ) {
      await runRoomHandedOff(
        tx,
        {
          roomId: event.roomId,
          workspaceId: room.workspaceId,
          consumerName: room.consumerName,
        },
        event.eventId,
      );
    }
    return "processed";
  }
  return "ignored";
}
