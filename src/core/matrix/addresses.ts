import { randomBytes } from "node:crypto";

import type { ContextTransaction } from "@/lib/prisma/with-context";

import { upsertMember } from "./accounts";
import { userId as mxidOf } from "./config";
import { createConversationRoom, type CreatedRoom } from "./rooms";
import {
  displayNameOf,
  invite,
  registerNamespaceUser,
  REPLY_POWER,
  type SynapseClient,
} from "./synapse";

/**
 * Address of a workspace on the chat (IN4a, plano-in4.md §4 answer 2): a
 * user of the reserved namespace, `@_guidu_w_<16 base32>:<server>`, with
 * the workspace's name. A consumer who invites it (from Element today, the
 * guidu.chat later) gets a conversation room opened by the core: the room
 * the consumer created is refused, as in the IN3, and the core invites the
 * consumer to a room of its own, in the order of the proof.
 */

export const ADDRESS_LOCALPART = /^_guidu_w_[a-z2-7]{16}$/;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function newAddressLocalpart(): string {
  let out = "_guidu_w_";
  for (const byte of randomBytes(16)) out += BASE32[byte & 31];
  return out;
}

type InfoRow = { organization_id: string; status: string; name: string };

async function workspaceNamed(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<InfoRow | null> {
  const rows = await tx.$queryRaw<InfoRow[]>`
    select organization_id, status, name from private.matrix_workspace_info(${workspaceId}::uuid)
  `;
  return rows[0] ?? null;
}

/**
 * The address of an active workspace, registered on Synapse with the
 * workspace's name (job `matrix.sync-workspace`). Idempotent; null when the
 * workspace is not active.
 */
export async function ensureWorkspaceAddress(
  tx: ContextTransaction,
  client: SynapseClient,
  workspaceId: string,
): Promise<string | null> {
  const workspace = await workspaceNamed(tx, workspaceId);
  if (workspace?.status !== "active") return null;
  const localpart = newAddressLocalpart();
  await tx.$executeRaw`
    insert into public.matrix_workspace_addresses (workspace_id, organization_id, localpart, mxid)
    values (${workspaceId}::uuid, ${workspace.organization_id}::uuid, ${localpart},
            ${mxidOf(client.config, localpart)})
    on conflict (workspace_id) do nothing
  `;
  const row = await tx.matrixWorkspaceAddress.findUniqueOrThrow({
    where: { workspaceId },
  });
  // Registered again on every run: it also keeps the name in line.
  await registerNamespaceUser(
    client,
    row.localpart,
    workspace.name.slice(0, 120),
  );
  if (row.state !== "active") {
    await tx.matrixWorkspaceAddress.update({
      where: { workspaceId },
      data: { state: "active" },
    });
  }
  return row.mxid;
}

/** The workspace an address belongs to, when it is active. */
export async function workspaceOfAddress(
  tx: ContextTransaction,
  mxid: string,
): Promise<string | null> {
  const row = await tx.matrixWorkspaceAddress.findUnique({
    where: { mxid },
    select: { workspaceId: true, state: true },
  });
  return row?.state === "active" ? row.workspaceId : null;
}

export type ConsumerRoom = Readonly<{
  roomId: string;
  created: boolean;
}>;

/**
 * A consumer called the store: the open conversation they already have is
 * reused (invited again when they left it); otherwise a new room is
 * created and they are invited to it.
 */
export async function openConsumerRoom(
  tx: ContextTransaction,
  client: SynapseClient,
  input: Readonly<{ workspaceId: string; consumerMxid: string }>,
): Promise<ConsumerRoom> {
  const current = await tx.matrixRoom.findFirst({
    where: {
      workspaceId: input.workspaceId,
      consumerMxid: input.consumerMxid,
      state: "active",
      status: { in: ["open", "pending"] },
      roomId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { roomId: true, organizationId: true },
  });
  if (current?.roomId) {
    const member = await tx.matrixRoomMember.findUnique({
      where: {
        roomId_userMxid: {
          roomId: current.roomId,
          userMxid: input.consumerMxid,
        },
      },
      select: { membership: true },
    });
    if (member?.membership !== "join" && member?.membership !== "invite") {
      await invite(client, current.roomId, input.consumerMxid);
      await upsertMember(
        tx,
        {
          roomId: current.roomId,
          workspaceId: input.workspaceId,
          organizationId: current.organizationId,
        },
        input.consumerMxid,
        "invite",
        null,
        REPLY_POWER,
      );
    }
    return { roomId: current.roomId, created: false };
  }
  const room: CreatedRoom = await createConversationRoom(tx, client, {
    workspaceId: input.workspaceId,
    consumerMxid: input.consumerMxid,
    consumerName: await displayNameOf(client, input.consumerMxid),
  });
  return { roomId: room.roomId, created: true };
}
