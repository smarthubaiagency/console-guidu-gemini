import "server-only";

import type { ContextTransaction } from "@/lib/prisma/with-context";

import { inboxAgentActive } from "./guids-settings";
import { LINK_CONTACT_JOB_KIND } from "./jobs";
import { noticeAssigned, noticeNewConversation } from "./notices";

/**
 * What the Inbox does when the core opens a room or mirrors an assignment
 * (IN4b), called by the hooks of `@/core/matrix/room-hooks`, as app_worker
 * in the core's transaction:
 * - a new room gets its link row, the job that makes its CRM contact (as a
 *   manager of the workspace, who may write contacts) and the notice of a
 *   new conversation to who answers;
 * - an assignment made by someone else tells the assignee.
 */

export type OpenedRoom = Readonly<{
  roomId: string;
  workspaceId: string;
  organizationId: string;
  consumerName: string | null;
}>;

async function managerOf(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ user_id: string }[]>`
    select user_id from private.matrix_workspace_access(${workspaceId}::uuid)
    where role in ('owner', 'admin')
    order by (role = 'owner') desc, user_id
    limit 1
  `;
  return rows[0]?.user_id ?? null;
}

export async function inboxRoomOpened(
  tx: ContextTransaction,
  room: OpenedRoom,
): Promise<void> {
  const manager = await managerOf(tx, room.workspaceId);
  await tx.$executeRaw`
    insert into public.inbox_conversations
      (room_id, organization_id, workspace_id, contact_state)
    values (${room.roomId}, ${room.organizationId}::uuid, ${room.workspaceId}::uuid,
            ${manager ? "pending" : "none"})
    on conflict (room_id) do nothing
  `;
  if (manager) {
    const organization = await tx.organization.findUnique({
      where: { id: room.organizationId },
      select: { partnerId: true },
    });
    await tx.$executeRaw`
      insert into public.job_runs
        (kind, scope, partner_id, organization_id, workspace_id, requested_by,
         payload, idempotency_key, max_attempts)
      values
        (${LINK_CONTACT_JOB_KIND}, 'workspace', ${organization?.partnerId ?? null}::uuid,
         ${room.organizationId}::uuid, ${room.workspaceId}::uuid, ${manager}::uuid,
         ${JSON.stringify({ roomId: room.roomId })}::jsonb,
         ${`inbox-link-contact:${room.roomId}`.slice(0, 200)}, 3)
      on conflict do nothing
    `;
  }
  // While the GUIDS answers, the team hears of the conversation only when
  // it is handed over (IN6).
  if (!(await inboxAgentActive(tx, room.workspaceId))) {
    await noticeNewConversation(tx, room);
  }
}

export async function inboxRoomAssigned(
  tx: ContextTransaction,
  room: Omit<OpenedRoom, "organizationId">,
  assignee: string,
  stateEventId: string,
): Promise<void> {
  await noticeAssigned(tx, room, assignee, stateEventId);
}

/** The GUIDS handed the conversation over: news for who answers (IN6). */
export async function inboxRoomHandedOff(
  tx: ContextTransaction,
  room: Omit<OpenedRoom, "organizationId">,
  stateEventId: string,
): Promise<void> {
  await noticeNewConversation(tx, room, stateEventId);
}
