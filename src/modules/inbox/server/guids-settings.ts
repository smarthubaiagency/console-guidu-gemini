import "server-only";

import { inboxGuidsOf } from "@/core/matrix/agent";
import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Whether a GUIDS answers the pending conversations of a workspace now
 * (IN6): the Inbox has one chosen and it is turned on. The notices of the
 * IN4b use it as a gate: "conversa nova" and "sem resposta" are not sent
 * for the conversations the GUIDS is answering. Works in the worker
 * (app_worker, through `private.inbox_guids_of`).
 */
export async function inboxAgentActive(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<boolean> {
  return (await inboxGuidsOf(tx, workspaceId))?.active === true;
}
