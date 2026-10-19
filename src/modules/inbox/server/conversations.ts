import "server-only";

import type { Prisma } from "@prisma/client";

import { isContactLocale } from "@/core/matrix/locale";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import type { ConversationPage, ConversationStatus, InboxView } from "../views";
import { labelsOfRooms, listLabels } from "./labels";

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
  ctx: RequestContext,
  input: Readonly<{
    view: InboxView;
    mxid: string | null;
    search?: string | null;
    /** Only conversations with this label (IN4b). */
    labelId?: string | null;
  }>,
): Promise<ConversationPage> {
  // RLS scopes the rooms too; the filter keeps the query honest without it.
  const base: Prisma.MatrixRoomWhereInput = {
    workspaceId: ctx.workspaceId,
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
  if (input.labelId) {
    const tagged = await tx.inboxRoomLabel.findMany({
      where: { labelId: input.labelId, workspaceId: ctx.workspaceId },
      select: { roomId: true },
      take: 1000,
    });
    where.roomId = { in: tagged.map((row) => row.roomId) };
  }
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
        contactLocale: true,
        contactLocaleSource: true,
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
  const [labels, byRoom] = await Promise.all([
    listLabels(tx, ctx),
    labelsOfRooms(
      tx,
      rows.map((row) => row.roomId!),
    ),
  ]);
  return {
    labels,
    items: rows.map((row) => ({
      roomId: row.roomId!,
      status: row.status as ConversationStatus,
      assignee: row.assignee,
      consumerMxid: row.consumerMxid,
      consumerName: row.consumerName,
      contactLocale: isContactLocale(row.contactLocale)
        ? row.contactLocale
        : null,
      contactLocaleManual: row.contactLocaleSource === "manual",
      updatedAt: row.updatedAt.toISOString(),
      labelIds: byRoom.get(row.roomId!) ?? [],
    })),
    counts: { mine, unassigned, all, resolved },
  };
}
