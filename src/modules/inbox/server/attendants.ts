import "server-only";

import { recordAudit } from "@/core/audit/record";
import { requestAccountSync } from "@/core/matrix";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { assertAttendantSeat } from "../quotas";
import { loadInboxViewer } from "./access";

/**
 * The attendant mark of a member (IN4a, decision of 17/10/2026): only the
 * managers of the Inbox (owner or admin) mark and unmark, only owners,
 * admins and editors can be marked (the Attendant role always answers),
 * and a new mark takes a place in the quota of the plan. The database
 * checks the same (policies of `inbox_attendants`); the account of the
 * person follows by the job `matrix.sync-account`.
 */

const MARKABLE_ROLES = new Set(["owner", "admin", "editor"]);

export async function setAttendantMark(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: Readonly<{ userId: string; marked: boolean }>,
): Promise<{ changed: boolean }> {
  const viewer = await loadInboxViewer(tx, ctx.userId);
  if (!viewer.manages) {
    throw new AppError({
      code: "forbidden",
      safeMessage: "Você não tem permissão para esta ação.",
      messageKey: "errors.permissionDenied",
    });
  }
  const where = {
    workspaceId_userId: { workspaceId: ctx.workspaceId, userId: input.userId },
  };
  const existing = await tx.inboxAttendant.findUnique({
    where,
    select: { userId: true },
  });

  if (!input.marked) {
    if (!existing) return { changed: false };
    await tx.inboxAttendant.delete({ where });
  } else {
    if (existing) return { changed: false };
    const role = await effectiveRole(tx, ctx, input.userId);
    if (!role || !MARKABLE_ROLES.has(role)) {
      throw new AppError({
        code: "invalid_input",
        safeMessage:
          "Só donos, administradores e editores do workspace podem ser marcados como atendentes.",
        messageKey: "inbox.errors.notMarkable",
      });
    }
    await assertAttendantSeat(tx, ctx);
    await tx.inboxAttendant.create({
      data: {
        workspaceId: ctx.workspaceId,
        organizationId: ctx.organizationId,
        userId: input.userId,
        createdBy: ctx.userId,
      },
    });
  }
  await requestAccountSync(tx, input.userId);
  await recordAudit(tx, ctx, {
    action: input.marked
      ? "inbox.attendant.marked"
      : "inbox.attendant.unmarked",
    resourceType: "workspace_member",
    resourceId: input.userId,
    result: "success",
    origin: "app",
    metadata: { targetUserId: input.userId },
  });
  return { changed: true };
}

/** Role of a person in the context workspace (the company owner stands in). */
async function effectiveRole(
  tx: ContextTransaction,
  ctx: RequestContext,
  userId: string,
): Promise<string | null> {
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } },
    select: { role: true, status: true, supportGrantId: true },
  });
  if (member) {
    return member.status === "active" && !member.supportGrantId
      ? member.role
      : null;
  }
  const owner = await tx.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: ctx.organizationId, userId },
    },
    select: { role: true, status: true },
  });
  return owner?.status === "active" && owner.role === "owner" ? "owner" : null;
}

/** Ids of who is marked in the context workspace (Equipe). */
export async function listAttendantMarks(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<Set<string>> {
  const rows = await tx.inboxAttendant.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}
