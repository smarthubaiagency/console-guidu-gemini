import { Permissions } from "@/core/permissions/catalog";
import { hasWorkspaceRolePermission } from "@/core/permissions/matrix";
import { isWorkspaceRole } from "@/core/permissions/roles";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { userId as mxidOf, type MatrixConfig } from "./config";
import { newAttendantLocalpart } from "./jwt";
import {
  ATTENDANT_POWER,
  deactivateUser,
  forceJoin,
  kick,
  MatrixHttpError,
  setUserPowers,
  type SynapseClient,
  upsertUser,
} from "./synapse";

/**
 * Accounts of the attendants (IN3, ADR 0023 rule 9). One Matrix account per
 * person, created when they hold `inbox.view` in an active workspace, put
 * in the rooms of those workspaces, taken out of the others and
 * deactivated when no workspace is left. The database says who is
 * eligible (`private.matrix_user_memberships`); the permission matrix says
 * which roles hold `inbox.view`.
 */

export type InboxMembership = Readonly<{
  workspaceId: string;
  organizationId: string;
  role: string;
  fullName: string | null;
}>;

type MembershipRow = {
  workspace_id: string;
  organization_id: string;
  role: string;
  full_name: string | null;
};

export function holdsInboxView(role: string): boolean {
  return (
    isWorkspaceRole(role) &&
    hasWorkspaceRolePermission(role, Permissions.INBOX_VIEW)
  );
}

function toMemberships(rows: MembershipRow[]): InboxMembership[] {
  const seen = new Set<string>();
  const out: InboxMembership[] = [];
  for (const row of rows) {
    if (!holdsInboxView(row.role) || seen.has(row.workspace_id)) continue;
    seen.add(row.workspace_id);
    out.push({
      workspaceId: row.workspace_id,
      organizationId: row.organization_id,
      role: row.role,
      fullName: row.full_name,
    });
  }
  return out;
}

/** Workspaces where a person holds `inbox.view` (worker). */
export async function inboxMemberships(
  tx: ContextTransaction,
  profileId: string,
): Promise<InboxMembership[]> {
  const rows = await tx.$queryRaw<MembershipRow[]>`
    select workspace_id, organization_id, role, full_name
    from private.matrix_user_memberships(${profileId}::uuid)
  `;
  return toMemberships(rows);
}

/** The same, for the person of the context (web). */
export async function myInboxMemberships(
  tx: ContextTransaction,
): Promise<InboxMembership[]> {
  const rows = await tx.$queryRaw<MembershipRow[]>`
    select workspace_id, organization_id, role, full_name
    from private.matrix_my_memberships()
  `;
  return toMemberships(rows);
}

/** Name shown on Matrix: the profile's, or a neutral one. */
export function displayName(fullName: string | null | undefined): string {
  const name = fullName?.trim();
  return name ? name.slice(0, 120) : "Atendente";
}

export type AccountRow = Readonly<{
  profileId: string;
  localpart: string;
  mxid: string;
  status: string;
}>;

/** The account row of a person, created with a fresh opaque localpart. */
export async function ensureAccountRow(
  tx: ContextTransaction,
  config: MatrixConfig,
  profileId: string,
): Promise<AccountRow & { created: boolean }> {
  const existing = await tx.matrixAccount.findUnique({ where: { profileId } });
  if (existing) return { ...existing, created: false };
  const localpart = newAttendantLocalpart();
  await tx.$executeRaw`
    insert into public.matrix_accounts (profile_id, localpart, mxid, status)
    values (${profileId}::uuid, ${localpart}, ${mxidOf(config, localpart)}, 'active')
    on conflict (profile_id) do nothing
  `;
  const row = await tx.matrixAccount.findUniqueOrThrow({
    where: { profileId },
  });
  return { ...row, created: row.localpart === localpart };
}

export async function upsertMember(
  tx: ContextTransaction,
  room: Readonly<{
    roomId: string;
    workspaceId: string;
    organizationId: string;
  }>,
  userMxid: string,
  membership: string,
  eventTs: bigint | null = null,
): Promise<void> {
  await tx.$executeRaw`
    insert into public.matrix_room_members
      (room_id, organization_id, workspace_id, user_mxid, membership, event_ts)
    values (${room.roomId}, ${room.organizationId}::uuid, ${room.workspaceId}::uuid,
            ${userMxid}, ${membership}, ${eventTs})
    on conflict (room_id, user_mxid) do update
      set membership = excluded.membership,
          event_ts = coalesce(excluded.event_ts, matrix_room_members.event_ts),
          updated_at = now()
      where excluded.event_ts is null
         or matrix_room_members.event_ts is null
         or excluded.event_ts >= matrix_room_members.event_ts
  `;
}

/**
 * Puts an attendant in a room: power 50 (to change the conversation state)
 * and a join by the admin API. An account missing on Synapse (its creation
 * failed earlier) is created and the join tried again.
 */
export async function joinAttendant(
  client: SynapseClient,
  roomId: string,
  account: Readonly<{ mxid: string; name: string }>,
): Promise<void> {
  await setUserPowers(client, roomId, { [account.mxid]: ATTENDANT_POWER });
  try {
    await forceJoin(client, roomId, account.mxid);
  } catch (error) {
    if (
      !(error instanceof MatrixHttpError) ||
      (error.status !== 404 && error.status !== 400)
    ) {
      throw error;
    }
    await upsertUser(client, account.mxid, account.name);
    await forceJoin(client, roomId, account.mxid);
  }
}

export async function removeAttendant(
  client: SynapseClient,
  roomId: string,
  mxid: string,
): Promise<void> {
  await kick(client, roomId, mxid, "Acesso ao atendimento encerrado.");
  await setUserPowers(client, roomId, { [mxid]: null });
}

export type AccountSyncResult = Readonly<{
  status: "none" | "active" | "deactivated";
  joined: number;
  removed: number;
  more: boolean;
}>;

/**
 * Brings the Matrix account of a person in line with the database
 * (idempotent; job `matrix.sync-account`). At most `batch` rooms are joined
 * and left per run; `more` asks for another run.
 */
export async function syncAccount(
  tx: ContextTransaction,
  client: SynapseClient,
  profileId: string,
  batch = 100,
): Promise<AccountSyncResult> {
  const memberships = await inboxMemberships(tx, profileId);
  const account = await tx.matrixAccount.findUnique({ where: { profileId } });

  if (memberships.length === 0) {
    if (!account) return { status: "none", joined: 0, removed: 0, more: false };
    if (account.status === "active") {
      // Deactivation also takes the account out of every room.
      await deactivateUser(client, account.mxid);
      await tx.matrixAccount.update({
        where: { profileId },
        data: { status: "deactivated", deactivatedAt: new Date() },
      });
    }
    const left = await tx.$executeRaw`
      update public.matrix_room_members set membership = 'leave', updated_at = now()
      where user_mxid = ${account.mxid} and membership in ('join', 'invite')
    `;
    return { status: "deactivated", joined: 0, removed: left, more: false };
  }

  const row = await ensureAccountRow(tx, client.config, profileId);
  const name = displayName(memberships[0]?.fullName);
  // Creates the account, brings a deactivated one back and keeps the name.
  await upsertUser(client, row.mxid, name);
  if (row.status !== "active") {
    await tx.matrixAccount.update({
      where: { profileId },
      data: { status: "active", deactivatedAt: null },
    });
  }

  const workspaceIds = memberships.map((m) => m.workspaceId);
  const toLeave = await tx.$queryRaw<
    { room_id: string; workspace_id: string; organization_id: string }[]
  >`
    select member.room_id, member.workspace_id, member.organization_id
    from public.matrix_room_members member
    where member.user_mxid = ${row.mxid}
      and member.membership in ('join', 'invite')
      and member.workspace_id <> all(${workspaceIds}::uuid[])
    order by member.room_id
    limit ${batch}
  `;
  for (const room of toLeave) {
    await removeAttendant(client, room.room_id, row.mxid);
    await upsertMember(
      tx,
      {
        roomId: room.room_id,
        workspaceId: room.workspace_id,
        organizationId: room.organization_id,
      },
      row.mxid,
      "leave",
    );
  }

  const toJoin = await tx.$queryRaw<
    { room_id: string; workspace_id: string; organization_id: string }[]
  >`
    select room.room_id, room.workspace_id, room.organization_id
    from public.matrix_rooms room
    where room.workspace_id = any(${workspaceIds}::uuid[])
      and room.state = 'active'
      and room.room_id is not null
      and not exists (
        select 1 from public.matrix_room_members member
        where member.room_id = room.room_id
          and member.user_mxid = ${row.mxid}
          and member.membership = 'join'
      )
    order by room.created_at
    limit ${batch}
  `;
  for (const room of toJoin) {
    await joinAttendant(client, room.room_id, { mxid: row.mxid, name });
    await upsertMember(
      tx,
      {
        roomId: room.room_id,
        workspaceId: room.workspace_id,
        organizationId: room.organization_id,
      },
      row.mxid,
      "join",
    );
  }

  return {
    status: "active",
    joined: toJoin.length,
    removed: toLeave.length,
    more: toLeave.length === batch || toJoin.length === batch,
  };
}
