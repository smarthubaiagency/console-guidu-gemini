import "server-only";

import type { InboxAccess } from "@/core/matrix/synapse";
import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Who the person of the context is in the Inbox of the context workspace
 * (IN4a): their level (`reply` for a marked attendant, `read` for an owner
 * or admin who is not one, null for the others), whether they manage it
 * (`inbox.manage`: owner or admin) and their Matrix account, when they
 * already have one. The database computes it (`private.matrix_access`).
 */
export type InboxViewer = Readonly<{
  level: InboxAccess | null;
  manages: boolean;
  mxid: string | null;
}>;

export async function loadInboxViewer(
  tx: ContextTransaction,
  userId: string,
): Promise<InboxViewer> {
  const [rows, account] = await Promise.all([
    tx.$queryRaw<{ level: string | null; manages: boolean }[]>`
      select private.inbox_my_level() as level, private.inbox_my_manages() as manages
    `,
    tx.matrixAccount.findUnique({
      where: { profileId: userId },
      select: { mxid: true, status: true },
    }),
  ]);
  const level = rows[0]?.level;
  return {
    level: level === "reply" || level === "read" ? level : null,
    manages: rows[0]?.manages === true,
    mxid: account?.status === "active" ? account.mxid : null,
  };
}
