import type { ContextTransaction } from "@/lib/prisma/with-context";
import {
  inboxRoomAssigned,
  inboxRoomOpened,
  type OpenedRoom,
} from "@/modules/inbox/server/room-opened";

/**
 * What modules do when the core opens a room or mirrors an assignment
 * (IN4b), by explicit import like the module registry: today only the
 * Inbox (CRM contact and notices). They run as app_worker in the core's
 * transaction, so a failure rolls the step back and the job tries again.
 */

export async function runRoomOpened(
  tx: ContextTransaction,
  room: OpenedRoom,
): Promise<void> {
  await inboxRoomOpened(tx, room);
}

export async function runRoomAssigned(
  tx: ContextTransaction,
  room: Omit<OpenedRoom, "organizationId">,
  assignee: string,
  stateEventId: string,
): Promise<void> {
  await inboxRoomAssigned(tx, room, assignee, stateEventId);
}
