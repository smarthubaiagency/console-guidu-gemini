import type { ContextTransaction } from "@/lib/prisma/with-context";
import {
  inboxRoomAssigned,
  inboxRoomHandedOff,
  inboxRoomOpened,
  type OpenedRoom,
} from "@/modules/inbox/server/room-opened";

/**
 * What modules do when the core opens a room, mirrors an assignment or a
 * handoff of the GUIDS (IN4b, IN6), by explicit import like the module registry: today only the
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

/** The GUIDS handed the conversation to the team (IN6). */
export async function runRoomHandedOff(
  tx: ContextTransaction,
  room: Omit<OpenedRoom, "organizationId">,
  stateEventId: string,
): Promise<void> {
  await inboxRoomHandedOff(tx, room, stateEventId);
}
