import "server-only";

import { emitEvent, WORKER_ACTOR } from "@/core/events/emit";
import { partnerConsoleOrigin } from "@/core/partners/console-origin";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { inboxAgentActive } from "./guids-settings";

/**
 * Notices of the Inbox in the Event Hub (IN4b, ADR 0022): a new
 * conversation (to who answers), a conversation assigned to you and a
 * conversation without an answer for 15 minutes (to the assignee, else to
 * who answers). Emitted by the worker as app_worker, one event per person
 * (route `subject_person`), each with its own key: running a step twice
 * tells nobody twice.
 */

export const UNANSWERED_AFTER_MS = 15 * 60_000;

type NoticeContext = Readonly<{
  partnerId: string;
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  inboxUrl: string;
}>;

async function noticeContext(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<NoticeContext | null> {
  // The worker reads an active workspace only through this function.
  const [workspace] = await tx.$queryRaw<
    { organization_id: string; status: string; name: string; slug: string }[]
  >`
    select organization_id, status, name, slug
    from private.inbox_workspace_link(${workspaceId}::uuid)
  `;
  if (!workspace || workspace.status !== "active") return null;
  const organization = await tx.organization.findUnique({
    where: { id: workspace.organization_id },
    select: { partnerId: true },
  });
  if (!organization?.partnerId) return null;
  const origin = await partnerConsoleOrigin(tx, organization.partnerId);
  return {
    partnerId: organization.partnerId,
    organizationId: workspace.organization_id,
    workspaceId,
    workspaceName: workspace.name,
    inboxUrl: new URL(
      `/app/${encodeURIComponent(workspace.slug)}/inbox`,
      origin,
    ).toString(),
  };
}

/** Who answers in a workspace (the attendant mark, IN4a). */
export async function attendantsOf(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ user_id: string }[]>`
    select distinct user_id from private.matrix_workspace_access(${workspaceId}::uuid)
    where access = 'reply'
  `;
  return rows.map((row) => row.user_id);
}

/** The person behind an attendant's Matrix account. */
export async function personOf(
  tx: ContextTransaction,
  mxid: string,
): Promise<string | null> {
  const account = await tx.matrixAccount.findUnique({
    where: { mxid },
    select: { profileId: true },
  });
  return account?.profileId ?? null;
}

function roomUrl(context: NoticeContext, roomId: string): string {
  const url = new URL(context.inboxUrl);
  url.searchParams.set("view", "all");
  url.searchParams.set("room", roomId);
  return url.toString();
}

async function emitTo(
  tx: ContextTransaction,
  context: NoticeContext,
  input: Readonly<{
    type:
      | "inbox.conversation.new"
      | "inbox.conversation.assigned"
      | "inbox.conversation.unanswered";
    roomId: string;
    people: readonly string[];
    contact: string | null;
    key: string;
  }>,
): Promise<number> {
  let emitted = 0;
  for (const person of new Set(input.people)) {
    const result = await emitEvent(tx, {
      type: input.type,
      actor: WORKER_ACTOR,
      partnerId: context.partnerId,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      subject: { type: "matrix_room", id: input.roomId.slice(0, 255) },
      recipientUserId: person,
      data: {
        contact: (input.contact ?? "").slice(0, 120),
        workspaceName: context.workspaceName.slice(0, 120),
        linkUrl: roomUrl(context, input.roomId),
      },
      idempotencyKey: `${input.key}:${person}`.slice(0, 200),
    });
    if (result.created) emitted += 1;
  }
  return emitted;
}

/**
 * A conversation arrived without anyone answering it yet, or the GUIDS
 * handed it over (`handoffEventId`, once per handoff).
 */
export async function noticeNewConversation(
  tx: ContextTransaction,
  room: Readonly<{
    roomId: string;
    workspaceId: string;
    consumerName: string | null;
  }>,
  handoffEventId: string | null = null,
): Promise<number> {
  const context = await noticeContext(tx, room.workspaceId);
  if (!context) return 0;
  return emitTo(tx, context, {
    type: "inbox.conversation.new",
    roomId: room.roomId,
    people: await attendantsOf(tx, room.workspaceId),
    contact: room.consumerName,
    key: handoffEventId
      ? `inbox-handoff:${handoffEventId}`
      : `inbox-new:${room.roomId}`,
  });
}

/** Someone else assigned the conversation to this attendant. */
export async function noticeAssigned(
  tx: ContextTransaction,
  room: Readonly<{
    roomId: string;
    workspaceId: string;
    consumerName: string | null;
  }>,
  assignee: string,
  stateEventId: string,
): Promise<number> {
  const person = await personOf(tx, assignee);
  if (!person) return 0;
  const context = await noticeContext(tx, room.workspaceId);
  if (!context) return 0;
  return emitTo(tx, context, {
    type: "inbox.conversation.assigned",
    roomId: room.roomId,
    people: [person],
    contact: room.consumerName,
    key: `inbox-assigned:${stateEventId}`,
  });
}

/**
 * Conversations whose last message is the consumer's for 15 minutes or
 * more, with nobody of the team (nor an agent) answering after it, in the
 * last day (platform job `inbox.unanswered`). Once per message without an
 * answer. A pending conversation is the GUIDS's while one is active (IN6).
 */
export async function noticeUnanswered(
  tx: ContextTransaction,
  now: Date = new Date(),
  batch = 200,
): Promise<{ rooms: number; notices: number }> {
  const rooms = await tx.$queryRaw<
    {
      room_id: string;
      workspace_id: string;
      status: string;
      assignee: string | null;
      consumer_name: string | null;
      last_consumer_message_at: Date;
    }[]
  >`
    select room.room_id, room.workspace_id, room.status, room.assignee, room.consumer_name,
           room.last_consumer_message_at
    from public.matrix_rooms room
    where room.state = 'active'
      and room.status in ('open', 'pending')
      and room.room_id is not null
      and room.last_consumer_message_at
          between ${now}::timestamptz - interval '1 day'
              and ${new Date(now.getTime() - UNANSWERED_AFTER_MS)}::timestamptz
      and coalesce(room.last_team_message_at, '-infinity') < room.last_consumer_message_at
      and coalesce(room.last_agent_message_at, '-infinity') < room.last_consumer_message_at
    order by room.last_consumer_message_at
    limit ${batch}
  `;
  const contexts = new Map<string, NoticeContext | null>();
  const agents = new Map<string, boolean>();
  let notices = 0;
  for (const room of rooms) {
    if (room.status === "pending") {
      if (!agents.has(room.workspace_id)) {
        agents.set(
          room.workspace_id,
          await inboxAgentActive(tx, room.workspace_id),
        );
      }
      if (agents.get(room.workspace_id)) continue;
    }
    if (!contexts.has(room.workspace_id)) {
      contexts.set(
        room.workspace_id,
        await noticeContext(tx, room.workspace_id),
      );
    }
    const context = contexts.get(room.workspace_id);
    if (!context) continue;
    const assignee = room.assignee ? await personOf(tx, room.assignee) : null;
    notices += await emitTo(tx, context, {
      type: "inbox.conversation.unanswered",
      roomId: room.room_id,
      people: assignee ? [assignee] : await attendantsOf(tx, room.workspace_id),
      contact: room.consumer_name,
      key: `inbox-unanswered:${room.room_id}:${room.last_consumer_message_at.toISOString()}`,
    });
  }
  return { rooms: rooms.length, notices };
}
