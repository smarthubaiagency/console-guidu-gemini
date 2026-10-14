import "server-only";

import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Hot-lead notices of a GUIDS (A6a), for its drawer: who, the score, the
 * channel and whether it reached the merchant. Owner, admin and editor
 * read them, as the lead log; others get null.
 */

export const NOTICES_SHOWN = 20;

export type LeadNoticeDto = Readonly<{
  id: string;
  contactName: string | null;
  points: number;
  temperature: string;
  channel: string;
  status: string;
  reason: string | null;
  createdAt: string;
  sentAt: string | null;
}>;

export async function listLeadNotices(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
): Promise<LeadNoticeDto[] | null> {
  const role = await getEffectiveWorkspaceRole(tx, ctx);
  if (role !== "owner" && role !== "admin" && role !== "editor") return null;
  const notices = await tx.aiLeadNotice.findMany({
    where: { agentId, workspaceId: ctx.workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: NOTICES_SHOWN,
  });
  const contacts = await tx.crmContact.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      id: { in: notices.map((n) => n.contactId) },
    },
    select: { id: true, name: true },
  });
  const names = new Map(contacts.map((c) => [c.id, c.name]));
  return notices.map((notice) => ({
    id: notice.id,
    contactName: names.get(notice.contactId) ?? null,
    points: notice.points,
    temperature: notice.temperature,
    channel: notice.channel,
    status: notice.status,
    reason: notice.reason,
    createdAt: notice.createdAt.toISOString(),
    sentAt: notice.sentAt?.toISOString() ?? null,
  }));
}
