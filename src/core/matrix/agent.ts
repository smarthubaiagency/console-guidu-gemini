import { randomBytes } from "node:crypto";

import type { ContextTransaction } from "@/lib/prisma/with-context";

import { upsertMember } from "./accounts";
import { userId as mxidOf } from "./config";
import {
  CONVERSATION_STATE,
  CONVERSATION_STATUSES,
  type ConversationStatus,
  forceJoin,
  kick,
  MatrixHttpError,
  registerNamespaceUser,
  REPLY_POWER,
  setConversationState,
  setUserPowers,
  type SynapseClient,
} from "./synapse";

/**
 * The GUIDS in the rooms of the Inbox (IN6, ADR 0023 rule 8). Each GUIDS
 * that answers the Inbox of a workspace has a user of the reserved
 * namespace, `@_guidu_a_<16 base32>:<server>`, with the agent's name, in
 * the rooms at power 10: it only sends messages. The state of the
 * conversation stays with the core, which writes it (handoff, back to the
 * bot). Which GUIDS answers comes from the Inbox settings
 * (`private.inbox_guids_of`); the turn itself is a job of the Inbox
 * (`inbox.guids-turn`), enqueued here when the consumer writes.
 */

export const AGENT_LOCALPART = /^_guidu_a_[a-z2-7]{16}$/;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function newAgentLocalpart(): string {
  let out = "_guidu_a_";
  for (const byte of randomBytes(16)) out += BASE32[byte & 31];
  return out;
}

export type InboxGuids = Readonly<{
  agentId: string;
  name: string;
  active: boolean;
  /** Who chose it: the turn runs as this person. */
  actor: string | null;
  groupingSeconds: number;
}>;

/** The GUIDS that answers the Inbox of a workspace, or null (worker). */
export async function inboxGuidsOf(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<InboxGuids | null> {
  const rows = await tx.$queryRaw<
    {
      agent_id: string;
      agent_name: string;
      agent_status: string;
      actor: string | null;
      grouping_seconds: number;
    }[]
  >`
    select agent_id, agent_name, agent_status, actor, grouping_seconds
    from private.inbox_guids_of(${workspaceId}::uuid)
  `;
  const row = rows[0];
  return row
    ? {
        agentId: row.agent_id,
        name: row.agent_name,
        active: row.agent_status === "active",
        actor: row.actor,
        groupingSeconds: row.grouping_seconds,
      }
    : null;
}

type WorkspaceRef = Readonly<{ workspaceId: string; organizationId: string }>;

/**
 * The user of a GUIDS, registered on Synapse with the agent's name.
 * Idempotent: registering again keeps the name in line.
 */
export async function ensureAgentUser(
  tx: ContextTransaction,
  client: SynapseClient,
  workspace: WorkspaceRef,
  guids: Pick<InboxGuids, "agentId" | "name">,
): Promise<string> {
  const localpart = newAgentLocalpart();
  await tx.$executeRaw`
    insert into public.matrix_agent_users (agent_id, workspace_id, organization_id, localpart, mxid)
    values (${guids.agentId}::uuid, ${workspace.workspaceId}::uuid, ${workspace.organizationId}::uuid,
            ${localpart}, ${mxidOf(client.config, localpart)})
    on conflict (agent_id) do nothing
  `;
  const row = await tx.matrixAgentUser.findUniqueOrThrow({
    where: { agentId: guids.agentId },
  });
  if (row.workspaceId !== workspace.workspaceId) {
    throw new Error("matrix: agent user of another workspace");
  }
  const name = guids.name.trim().slice(0, 120) || "GUIDS";
  await registerNamespaceUser(client, row.localpart, name);
  if (row.state !== "active" || row.displayName !== name) {
    await tx.matrixAgentUser.update({
      where: { agentId: guids.agentId },
      data: { state: "active", displayName: name },
    });
  }
  return row.mxid;
}

/** Puts the agent's user in a room: power 10, then a join (admin API). */
export async function joinAgent(
  client: SynapseClient,
  roomId: string,
  mxid: string,
): Promise<void> {
  await setUserPowers(client, roomId, { [mxid]: REPLY_POWER });
  try {
    await forceJoin(client, roomId, mxid);
  } catch (error) {
    // Already in the room.
    if (!(error instanceof MatrixHttpError && error.status === 403)) {
      throw error;
    }
  }
}

/** The agent's user of a workspace for a room being created, or null. */
export async function agentForNewRoom(
  tx: ContextTransaction,
  client: SynapseClient,
  workspace: WorkspaceRef,
): Promise<string | null> {
  const guids = await inboxGuidsOf(tx, workspace.workspaceId);
  if (!guids) return null;
  return ensureAgentUser(tx, client, workspace, guids);
}

export type AgentSyncResult = Readonly<{
  agent: string | null;
  joined: number;
  removed: number;
  more: boolean;
}>;

/**
 * Follows the Inbox settings of a workspace (job `matrix.sync-agent`): the
 * user of the chosen GUIDS joins the active rooms; the users of other
 * GUIDS of the workspace leave them. Batches of rooms; `more` asks for
 * another run.
 */
export async function syncWorkspaceAgent(
  tx: ContextTransaction,
  client: SynapseClient,
  workspaceId: string,
  batch = 50,
): Promise<AgentSyncResult> {
  const info = await tx.$queryRaw<
    { organization_id: string; status: string }[]
  >`
    select organization_id, status from private.matrix_workspace_info(${workspaceId}::uuid)
  `;
  const workspace = info[0];
  if (workspace?.status !== "active") {
    return { agent: null, joined: 0, removed: 0, more: false };
  }
  const ref = { workspaceId, organizationId: workspace.organization_id };
  const guids = await inboxGuidsOf(tx, workspaceId);
  const current = guids ? await ensureAgentUser(tx, client, ref, guids) : null;

  let joined = 0;
  let removed = 0;
  // The rooms of a number have the GUIDS of the number's route (IN7a).
  const numberRooms = (
    await tx.matrixRoom.findMany({
      where: { workspaceId, channelConversationId: { not: null } },
      select: { roomId: true },
    })
  ).flatMap((room) => (room.roomId ? [room.roomId] : []));
  // Users of other agents of this workspace leave the rooms.
  const others = await tx.matrixAgentUser.findMany({
    where: {
      workspaceId,
      ...(current ? { mxid: { not: current } } : {}),
    },
    select: { mxid: true },
  });
  if (others.length > 0) {
    const stale = await tx.matrixRoomMember.findMany({
      where: {
        workspaceId,
        userMxid: { in: others.map((o) => o.mxid) },
        membership: { in: ["join", "invite"] },
        roomId: { notIn: numberRooms },
      },
      take: batch,
      select: { roomId: true, userMxid: true },
    });
    for (const member of stale) {
      await kick(
        client,
        member.roomId,
        member.userMxid,
        "Outro agente atende.",
      );
      await setUserPowers(client, member.roomId, { [member.userMxid]: null });
      await upsertMember(
        tx,
        { roomId: member.roomId, ...ref },
        member.userMxid,
        "leave",
        null,
        0,
      );
      removed += 1;
    }
    if (stale.length === batch) {
      return { agent: current, joined, removed, more: true };
    }
  }
  if (!current) return { agent: null, joined, removed, more: false };

  const rooms = await tx.matrixRoom.findMany({
    where: {
      workspaceId,
      state: "active",
      roomId: { not: null },
      channelConversationId: null,
      NOT: {
        roomId: {
          in: (
            await tx.matrixRoomMember.findMany({
              where: { workspaceId, userMxid: current, membership: "join" },
              select: { roomId: true },
            })
          ).map((m) => m.roomId),
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: batch,
    select: { roomId: true },
  });
  for (const room of rooms) {
    await joinAgent(client, room.roomId!, current);
    await upsertMember(
      tx,
      { roomId: room.roomId!, ...ref },
      current,
      "join",
      null,
      REPLY_POWER,
    );
    joined += 1;
  }
  return { agent: current, joined, removed, more: rooms.length === batch };
}

/**
 * A message of the consumer was recorded (processing of the Application
 * Service). A resolved conversation comes back as pending, so the GUIDS
 * (or the team) sees it again (plano-in4b-in6.md §5, answer 8); a pending
 * one starts the GUIDS's turn after the grouping window, when the
 * workspace has an Inbox GUIDS turned on.
 */
export async function onConsumerMessage(
  tx: ContextTransaction,
  client: SynapseClient,
  room: Readonly<{
    id: string;
    roomId: string;
    status: string;
    statusEventTs: bigint | null;
  }>,
  sentAt: bigint | null,
): Promise<Readonly<{ reopened: boolean; run: string | null }>> {
  let status = room.status;
  let reopened = false;
  if (
    status === "resolved" &&
    (room.statusEventTs === null ||
      sentAt === null ||
      sentAt > room.statusEventTs)
  ) {
    const eventId = await setConversationState(client, room.roomId, {
      status: "pending",
      assignee: null,
    });
    // The mirror follows at once; the state event confirms it later.
    await tx.$executeRaw`
      update public.matrix_rooms
      set status = 'pending', assignee = null, status_event_id = ${eventId}
      where id = ${room.id}::uuid and status = 'resolved'
    `;
    status = "pending";
    reopened = true;
  }
  if (status !== "pending") return { reopened, run: null };
  const rows = await tx.$queryRaw<{ run: string | null }[]>`
    select private.inbox_guids_enqueue(${room.roomId}) as run
  `;
  return { reopened, run: rows[0]?.run ?? null };
}

// ---------------------------------------------------------------------------
// Synapse, for the turn of the Inbox
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;

export type RoomMessage = Readonly<{
  eventId: string;
  sender: string;
  ts: number;
  body: string;
  /**
   * Set on a change of the conversation state (its new status), with an
   * empty body: the turn tells what was said to the team from what was
   * said to the GUIDS.
   */
  status?: ConversationStatus;
}>;

/**
 * The latest text messages of a room and the changes of the conversation
 * state among them, oldest first, read as the core (it created the room
 * and stays in it). Only `m.text`-like bodies; files and other events are
 * left out (text only in the IN6).
 */
export async function recentMessages(
  client: SynapseClient,
  roomId: string,
  limit = 50,
): Promise<RoomMessage[]> {
  const page = await client.request<{ chunk?: unknown[] }>(
    "GET",
    `/_matrix/client/v3/rooms/${enc(roomId)}/messages`,
    {
      query: {
        dir: "b",
        limit: String(limit),
        filter: JSON.stringify({
          types: ["m.room.message", CONVERSATION_STATE],
        }),
      },
    },
  );
  const out: RoomMessage[] = [];
  for (const raw of page.chunk ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as Record<string, unknown>;
    const content = (event.content ?? {}) as Record<string, unknown>;
    if (
      event.type === CONVERSATION_STATE &&
      event.state_key === "" &&
      typeof event.event_id === "string" &&
      typeof event.sender === "string" &&
      typeof event.origin_server_ts === "number" &&
      (CONVERSATION_STATUSES as readonly unknown[]).includes(content.status)
    ) {
      out.push({
        eventId: event.event_id,
        sender: event.sender,
        ts: event.origin_server_ts,
        body: "",
        status: content.status as ConversationStatus,
      });
      continue;
    }
    if (
      event.type !== "m.room.message" ||
      typeof event.event_id !== "string" ||
      typeof event.sender !== "string" ||
      typeof event.origin_server_ts !== "number" ||
      typeof content.body !== "string" ||
      !["m.text", "m.notice", "m.emote"].includes(String(content.msgtype))
    ) {
      continue;
    }
    out.push({
      eventId: event.event_id,
      sender: event.sender,
      ts: event.origin_server_ts,
      body: content.body,
    });
  }
  return out.reverse();
}

/** Sends a text as the agent's user; the transaction id makes it once. */
export async function sendAsAgent(
  client: SynapseClient,
  roomId: string,
  agentMxid: string,
  txnId: string,
  body: string,
): Promise<string | null> {
  const { event_id } = await client.request<{ event_id?: string }>(
    "PUT",
    `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${enc(txnId)}`,
    { body: { msgtype: "m.text", body }, asUser: agentMxid },
  );
  return typeof event_id === "string" ? event_id : null;
}

/** "Typing…" of the agent's user (a courtesy: failures are ignored). */
export async function setAgentTyping(
  client: SynapseClient,
  roomId: string,
  agentMxid: string,
  typing: boolean,
): Promise<void> {
  try {
    await client.request(
      "PUT",
      `/_matrix/client/v3/rooms/${enc(roomId)}/typing/${enc(agentMxid)}`,
      {
        body: typing ? { typing: true, timeout: 30_000 } : { typing: false },
        asUser: agentMxid,
      },
    );
  } catch {
    // The answer goes on without it.
  }
}
