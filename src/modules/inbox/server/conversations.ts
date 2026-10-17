import "server-only";

import type { Prisma } from "@prisma/client";

import type { ContextTransaction } from "@/lib/prisma/with-context";

import type { ConversationPage, ConversationStatus, InboxView } from "../views";

/**
 * The list of a view (IN4a, ADR 0023 rule 10): the mirror of the
 * conversation state in `matrix_rooms`, because Synapse does not filter by
 * a state event. Only the active rooms of the context workspace (policies
 * of the IN3, by level since the IN4a). The messages and the order by the
 * last one come from Matrix in the browser.
 */

const PAGE_SIZE = 100;

function whereOf(
  view: InboxView,
  mxid: string | null,
): Prisma.MatrixRoomWhereInput {
  switch (view) {
    case "mine":
      // Without an account nothing is theirs yet.
      return mxid
        ? { assignee: mxid, status: { not: "resolved" } }
        : { id: { in: [] } };
    case "unassigned":
      return { assignee: null, status: { not: "resolved" } };
    case "all":
      return { status: { not: "resolved" } };
    case "resolved":
      return { status: "resolved" };
  }
}

export async function listConversations(
  tx: ContextTransaction,
  input: Readonly<{
    view: InboxView;
    mxid: string | null;
    search?: string | null;
  }>,
): Promise<ConversationPage> {
  const base: Prisma.MatrixRoomWhereInput = {
    state: "active",
    roomId: { not: null },
  };
  const search = input.search?.trim().slice(0, 80);
  const where: Prisma.MatrixRoomWhereInput = {
    ...base,
    ...whereOf(input.view, input.mxid),
    ...(search
      ? { consumerName: { contains: search, mode: "insensitive" } }
      : {}),
  };
  const [rows, mine, unassigned, all, resolved] = await Promise.all([
    tx.matrixRoom.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
      select: {
        roomId: true,
        status: true,
        assignee: true,
        consumerMxid: true,
        consumerName: true,
        updatedAt: true,
      },
    }),
    tx.matrixRoom.count({ where: { ...base, ...whereOf("mine", input.mxid) } }),
    tx.matrixRoom.count({
      where: { ...base, ...whereOf("unassigned", input.mxid) },
    }),
    tx.matrixRoom.count({ where: { ...base, ...whereOf("all", input.mxid) } }),
    tx.matrixRoom.count({
      where: { ...base, ...whereOf("resolved", input.mxid) },
    }),
  ]);
  return {
    items: rows.map((row) => ({
      roomId: row.roomId!,
      status: row.status as ConversationStatus,
      assignee: row.assignee,
      consumerMxid: row.consumerMxid,
      consumerName: row.consumerName,
      updatedAt: row.updatedAt.toISOString(),
    })),
    counts: { mine, unassigned, all, resolved },
  };
}
