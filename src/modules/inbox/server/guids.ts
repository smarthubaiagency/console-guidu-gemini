import "server-only";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { inboxConfigOf } from "../settings";

/**
 * What the context panel shows of the Inbox GUIDS (IN6): the agent that
 * answers the pending conversations, by the name the consumer sees in the
 * room, and its last handoff in this room (summary and reason), which only
 * the team reads. The policies show both to whoever has a level in the
 * Inbox.
 */

export type GuidsPanel = Readonly<{
  /** Null when no GUIDS answers the Inbox. */
  agent: Readonly<{ name: string }> | null;
  handoff: Readonly<{
    summary: string;
    reason: string | null;
    at: string;
  }> | null;
}>;

export async function loadGuidsPanel(
  tx: ContextTransaction,
  ctx: RequestContext,
  roomId: string,
): Promise<GuidsPanel> {
  const inbox = await tx.workspaceModule.findFirst({
    where: { workspaceId: ctx.workspaceId, moduleKey: "inbox" },
    select: { config: true },
  });
  const agentId = inboxConfigOf(inbox?.config).guids_agent_id;
  const [user, room] = await Promise.all([
    agentId
      ? tx.matrixAgentUser.findUnique({
          where: { agentId },
          select: { displayName: true, workspaceId: true },
        })
      : null,
    tx.inboxGuidsRoom.findFirst({
      where: { roomId, workspaceId: ctx.workspaceId },
      select: { handoffSummary: true, handoffReason: true, handoffAt: true },
    }),
  ]);
  return {
    agent: agentId
      ? {
          name:
            user?.workspaceId === ctx.workspaceId && user.displayName
              ? user.displayName
              : "GUIDS",
        }
      : null,
    handoff:
      room?.handoffSummary && room.handoffAt
        ? {
            summary: room.handoffSummary,
            reason: room.handoffReason,
            at: room.handoffAt.toISOString(),
          }
        : null,
  };
}
