import type { ContextTransaction } from "@/lib/prisma/with-context";

import {
  displayName,
  ensureAccountRow,
  holdsInboxView,
  joinAttendant,
  removeAttendant,
  upsertMember,
} from "./accounts";
import { coreUserId } from "./config";
import {
  createRoom,
  deleteRoom,
  invite,
  listRooms,
  roomCreatedAt,
  type SynapseClient,
  upsertUser,
} from "./synapse";

/**
 * Conversation rooms of a workspace (IN3, ADR 0023). The core creates each
 * room in the order the proof of concept settled on: the row first, then
 * the room on Synapse without the consumer, its `room_id` recorded, the
 * attendants in, and only then the consumer invited, so their first
 * message never reaches an unknown room. All of it runs as app_worker in
 * the caller's transaction; a room left behind on Synapse by a rolled back
 * transaction is found and deleted by `cleanupRooms`.
 */

type PersonRow = { user_id: string; role: string; full_name: string | null };

/** Attendants of an active workspace, each with an account row. */
export async function workspaceAttendants(
  tx: ContextTransaction,
  client: SynapseClient,
  workspaceId: string,
): Promise<{ mxid: string; name: string }[]> {
  const people = await tx.$queryRaw<PersonRow[]>`
    select user_id, role, full_name from private.matrix_workspace_people(${workspaceId}::uuid)
  `;
  const seen = new Set<string>();
  const out: { mxid: string; name: string }[] = [];
  for (const person of people) {
    if (!holdsInboxView(person.role) || seen.has(person.user_id)) continue;
    seen.add(person.user_id);
    const account = await ensureAccountRow(tx, client.config, person.user_id);
    const name = displayName(person.full_name);
    if (account.created || account.status !== "active") {
      await upsertUser(client, account.mxid, name);
      if (account.status !== "active") {
        await tx.matrixAccount.update({
          where: { profileId: person.user_id },
          data: { status: "active", deactivatedAt: null },
        });
      }
    }
    out.push({ mxid: account.mxid, name });
  }
  return out;
}

export async function workspaceInfo(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<{ organizationId: string; status: string } | null> {
  const rows = await tx.$queryRaw<
    { organization_id: string; status: string }[]
  >`
    select organization_id, status from private.matrix_workspace(${workspaceId}::uuid)
  `;
  const row = rows[0];
  return row
    ? { organizationId: row.organization_id, status: row.status }
    : null;
}

export type CreatedRoom = Readonly<{
  id: string;
  roomId: string;
  attendants: number;
}>;

export async function createConversationRoom(
  tx: ContextTransaction,
  client: SynapseClient,
  input: Readonly<{
    workspaceId: string;
    origin?: "matrix" | "meta";
    /** The consumer (guidu.chat) or the contact's virtual user (Meta). */
    consumerMxid?: string | null;
    name?: string | null;
  }>,
): Promise<CreatedRoom> {
  const workspace = await workspaceInfo(tx, input.workspaceId);
  if (workspace?.status !== "active") {
    throw new Error("matrix: rooms are created only for an active workspace");
  }
  const organizationId = workspace.organizationId;

  const row = await tx.matrixRoom.create({
    data: {
      workspaceId: input.workspaceId,
      organizationId,
      origin: input.origin ?? "matrix",
      state: "creating",
    },
    select: { id: true },
  });
  const attendants = await workspaceAttendants(tx, client, input.workspaceId);
  const roomId = await createRoom(client, {
    name: input.name ?? null,
    attendants: attendants.map((a) => a.mxid),
  });
  await tx.matrixRoom.update({ where: { id: row.id }, data: { roomId } });
  const ref = { roomId, workspaceId: input.workspaceId, organizationId };
  for (const attendant of attendants) {
    await joinAttendant(client, roomId, attendant);
    await upsertMember(tx, ref, attendant.mxid, "join");
  }
  if (input.consumerMxid) {
    await invite(client, roomId, input.consumerMxid);
    await upsertMember(tx, ref, input.consumerMxid, "invite");
  }
  await tx.matrixRoom.update({
    where: { id: row.id },
    data: { state: "active", consumerMxid: input.consumerMxid ?? null },
  });
  return { id: row.id, roomId, attendants: attendants.length };
}

export type WorkspaceSyncResult = Readonly<{
  action: "restore" | "block" | "none";
  rooms: number;
  more: boolean;
}>;

/**
 * Follows the workspace's status (job `matrix.sync-workspace`): outside
 * `active` (soft deletion, suspension) the attendants leave every room and
 * the rooms are `blocked`; back to `active`, the attendants return. The
 * consumer stays in the room; the WS1 keeps the agent from answering.
 */
export async function syncWorkspaceRooms(
  tx: ContextTransaction,
  client: SynapseClient,
  workspaceId: string,
  batch = 50,
): Promise<WorkspaceSyncResult> {
  const status = (await workspaceInfo(tx, workspaceId))?.status ?? null;
  if (status === "active") {
    const rooms = await tx.matrixRoom.findMany({
      where: { workspaceId, state: "blocked", roomId: { not: null } },
      orderBy: { createdAt: "asc" },
      take: batch,
      select: { id: true, roomId: true, organizationId: true },
    });
    if (rooms.length === 0) return { action: "none", rooms: 0, more: false };
    const attendants = await workspaceAttendants(tx, client, workspaceId);
    for (const room of rooms) {
      const ref = {
        roomId: room.roomId!,
        workspaceId,
        organizationId: room.organizationId,
      };
      for (const attendant of attendants) {
        await joinAttendant(client, ref.roomId, attendant);
        await upsertMember(tx, ref, attendant.mxid, "join");
      }
      await tx.matrixRoom.update({
        where: { id: room.id },
        data: { state: "active" },
      });
    }
    return {
      action: "restore",
      rooms: rooms.length,
      more: rooms.length === batch,
    };
  }

  const rooms = await tx.matrixRoom.findMany({
    where: { workspaceId, state: "active", roomId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: batch,
    select: { id: true, roomId: true },
  });
  for (const room of rooms) {
    const members = await tx.$queryRaw<{ user_mxid: string }[]>`
      select member.user_mxid
      from public.matrix_room_members member
      join public.matrix_accounts account on account.mxid = member.user_mxid
      where member.room_id = ${room.roomId} and member.membership in ('join', 'invite')
    `;
    for (const member of members) {
      await removeAttendant(client, room.roomId!, member.user_mxid);
    }
    await tx.$executeRaw`
      update public.matrix_room_members member set membership = 'leave', updated_at = now()
      from public.matrix_accounts account
      where account.mxid = member.user_mxid and member.room_id = ${room.roomId}
        and member.membership in ('join', 'invite')
    `;
    await tx.matrixRoom.update({
      where: { id: room.id },
      data: { state: "blocked" },
    });
  }
  return {
    action: rooms.length ? "block" : "none",
    rooms: rooms.length,
    more: rooms.length === batch,
  };
}

/**
 * Deletes every room of a workspace on Synapse, with purge (WS1, "apagar
 * de vez"). Idempotent: a room already gone counts as deleted, and the
 * rows stay (state `closed`) until the database purge removes them.
 */
export async function purgeWorkspaceRooms(
  tx: ContextTransaction,
  client: SynapseClient,
  workspaceId: string,
): Promise<{ deleted: number }> {
  const rooms = await tx.matrixRoom.findMany({
    where: { workspaceId, state: { not: "closed" }, roomId: { not: null } },
    select: { id: true, roomId: true },
  });
  for (const room of rooms) {
    await deleteRoom(client, room.roomId!);
    await tx.matrixRoom.update({
      where: { id: room.id },
      data: { state: "closed", closedAt: new Date() },
    });
  }
  return { deleted: rooms.length };
}

const CREATING_TIMEOUT_MS = 15 * 60_000;
const ORPHAN_AGE_MS = 60 * 60_000;
const SWEEP_PAGES = 20;
const SWEEP_DELETES = 50;

export type CleanupResult = Readonly<{
  staleRows: number;
  orphansDeleted: number;
  transactionsDropped: number;
  eventsDropped: number;
}>;

/**
 * Hourly cleanup (job `matrix.cleanup`): rows stuck in `creating`, rooms
 * the core created on Synapse that no row knows (a creation rolled back
 * after `createRoom`), older than an hour, and the bookkeeping of the
 * Application Service past its retention.
 */
export async function cleanupRooms(
  tx: ContextTransaction,
  client: SynapseClient,
  now: Date = new Date(),
): Promise<CleanupResult> {
  const stale = await tx.matrixRoom.findMany({
    where: {
      state: "creating",
      createdAt: { lt: new Date(now.getTime() - CREATING_TIMEOUT_MS) },
    },
    select: { id: true, roomId: true },
    take: 100,
  });
  for (const row of stale) {
    if (row.roomId) await deleteRoom(client, row.roomId);
    await tx.matrixRoom.delete({ where: { id: row.id } });
  }

  const core = coreUserId(client.config);
  let orphansDeleted = 0;
  let from = 0;
  for (
    let page = 0;
    page < SWEEP_PAGES && orphansDeleted < SWEEP_DELETES;
    page += 1
  ) {
    const { rooms, next } = await listRooms(client, from);
    const mine = rooms
      .filter((room) => room.creator === core)
      .map((room) => room.room_id);
    if (mine.length > 0) {
      const known = await tx.matrixRoom.findMany({
        where: { roomId: { in: mine } },
        select: { roomId: true },
      });
      const knownIds = new Set(known.map((k) => k.roomId));
      for (const roomId of mine) {
        if (knownIds.has(roomId) || orphansDeleted >= SWEEP_DELETES) continue;
        const createdAt = await roomCreatedAt(client, roomId);
        if (createdAt === null || now.getTime() - createdAt < ORPHAN_AGE_MS)
          continue;
        if (await deleteRoom(client, roomId)) orphansDeleted += 1;
      }
    }
    if (next === null) break;
    from = next;
  }

  const transactionsDropped = await tx.$executeRaw`
    delete from public.matrix_as_transactions where received_at < ${now}::timestamptz - interval '7 days'
  `;
  const eventsDropped = await tx.$executeRaw`
    delete from public.matrix_events
    where status <> 'pending' and received_at < ${now}::timestamptz - interval '30 days'
  `;
  return {
    staleRows: stale.length,
    orphansDeleted,
    transactionsDropped,
    eventsDropped,
  };
}
