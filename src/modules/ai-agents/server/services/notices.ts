import "server-only";

import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Notices of a GUIDS to the merchant, for its drawer: hot leads (A6a) and
 * referrals given (A6b), with who, the score or the referral, the channel
 * and whether it reached the merchant. Owner, admin and editor
 * read them, as the lead log; others get null.
 */

export const NOTICES_SHOWN = 20;

export type LeadNoticeDto = Readonly<{
  id: string;
  kind: "lead" | "referral";
  contactName: string | null;
  /** Lead: the score. */
  points: number | null;
  /** Referral: who was recommended. */
  referralName: string | null;
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
  const ids = (values: (string | null)[]) =>
    values.filter((id): id is string => id !== null);
  const [contacts, referrals] = await Promise.all([
    tx.crmContact.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        id: { in: ids(notices.map((n) => n.contactId)) },
      },
      select: { id: true, name: true },
    }),
    tx.aiAgentReferral.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        id: { in: ids(notices.map((n) => n.referralId)) },
      },
      select: { id: true, name: true },
    }),
  ]);
  const names = new Map(contacts.map((c) => [c.id, c.name]));
  const referralNames = new Map(referrals.map((r) => [r.id, r.name]));
  return notices.map((notice) => ({
    id: notice.id,
    kind: notice.kind === "referral" ? "referral" : "lead",
    contactName: notice.contactId
      ? (names.get(notice.contactId) ?? null)
      : null,
    points: notice.points,
    referralName: notice.referralId
      ? (referralNames.get(notice.referralId) ?? null)
      : null,
    channel: notice.channel,
    status: notice.status,
    reason: notice.reason,
    createdAt: notice.createdAt.toISOString(),
    sentAt: notice.sentAt?.toISOString() ?? null,
  }));
}
