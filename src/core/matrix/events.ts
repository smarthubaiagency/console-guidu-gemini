import type { ContextTransaction } from "@/lib/prisma/with-context";

import { upsertMember } from "./accounts";
import { openConsumerRoom, workspaceOfAddress } from "./addresses";
import { isNamespaceUser } from "./config";
import { ATTENDANT_LOCALPART } from "./jwt";
import {
  CONVERSATION_STATE,
  CONVERSATION_STATUSES,
  type ConversationStatus,
  leaveAs,
  type SynapseClient,
} from "./synapse";

/**
 * What the core keeps of a transaction of the Application Service (IN3).
 * The route reduces each event to the few fields processing reads, and
 * drops every other type: the messages stay in Synapse (ADR 0023, rule 6).
 */

export type ReducedEvent = Readonly<{
  event_id: string;
  room_id: string;
  type: "m.room.member" | typeof CONVERSATION_STATE;
  state_key: string;
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
  if (
    !eventId ||
    !roomId ||
    !sender ||
    !content ||
    typeof event.state_key !== "string"
  )
    return null;
  const ts =
    typeof event.origin_server_ts === "number"
      ? Math.trunc(event.origin_server_ts)
      : null;
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
    return updated > 0 ? "processed" : "ignored";
  }
  return "ignored";
}
