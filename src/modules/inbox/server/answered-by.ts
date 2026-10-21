import "server-only";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Who wrote the answers of the GUIDS in a room (GF2): the role of the
 * specialist that answered under the orchestrator's name, by event. It is
 * kept in the database, never in the room (ADR 0023, rule 6), and read only
 * by the team's window.
 */

export const MAX_ANSWER_EVENTS = 200;

export type AnsweredByDto = Readonly<{
  eventId: string;
  role: "attendant" | "seller";
}>;

export async function loadAnsweredBy(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: Readonly<{ roomId: string; eventIds: readonly string[] }>,
): Promise<AnsweredByDto[]> {
  const eventIds = [...new Set(input.eventIds)].slice(0, MAX_ANSWER_EVENTS);
  if (eventIds.length === 0) return [];
  const rows = await tx.inboxGuidsAnswer.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      roomId: input.roomId,
      eventId: { in: eventIds },
    },
    select: { eventId: true, role: true },
  });
  return rows.flatMap((row) =>
    row.role === "attendant" || row.role === "seller"
      ? [{ eventId: row.eventId, role: row.role }]
      : [],
  );
}
