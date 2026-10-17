import "server-only";

import {
  type AuditCursor,
  encodeAuditCursor,
  parseAuditCursor,
} from "@/core/audit/platform-filters";
import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Security events (CF5a): the security actions of `audit_events`, read
 * through `private.security_events` (the table has no direct reads). The
 * platform (owner, operations, support) reads all; partner managers read
 * the events tagged with their partner and those of their customers'
 * companies. The caller's context decides which: the platform reads in an
 * identity context, the partner with its partner id.
 *
 * Pages by (`occurred_at`, `id`) with the instant in microseconds, like the
 * AUD1 trail (AJ1): a cursor of milliseconds skipped the events written in
 * the same millisecond as the last one shown.
 */

export const SECURITY_EVENTS_PAGE = 50;

export type SecurityEvent = Readonly<{
  id: string;
  occurredAt: Date;
  action: string;
  result: "success" | "denied" | "error";
  origin: string;
  actorUserId: string | null;
  /** E-mail of the actor when the viewer may see it, else null. */
  actorEmail: string | null;
  workspaceId: string | null;
  resourceType: string;
}>;

export type SecurityEventsPage = Readonly<{
  events: SecurityEvent[];
  /** Cursor of the next (older) page (`<instant>_<id>`), or null at the end. */
  nextBefore: string | null;
}>;

export type SecurityEventsCursor = AuditCursor;

type Row = {
  id: string;
  occurred_at: Date;
  cursor_at: string;
  action: string;
  result: string;
  origin: string;
  actor_user_id: string | null;
  workspace_id: string | null;
  resource_type: string;
};

/** A cursor from the address bar (`<instant>_<id>`), or null. */
export function parseBefore(
  raw: string | string[] | undefined,
): SecurityEventsCursor | null {
  return parseAuditCursor(raw);
}

export async function listSecurityEvents(
  tx: ContextTransaction,
  options: Readonly<{
    before?: SecurityEventsCursor | null;
    limit?: number;
  }> = {},
): Promise<SecurityEventsPage> {
  const limit = options.limit ?? SECURITY_EVENTS_PAGE;
  const before = options.before ?? null;
  const rows = await tx.$queryRaw<Row[]>`
    select id, occurred_at,
           to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
           action, result, origin, actor_user_id, workspace_id, resource_type
    from private.security_events(
      ${before?.at ?? null}::timestamptz,
      ${before?.id ?? null}::uuid,
      ${limit + 1}::integer
    )
  `;
  const page = rows.slice(0, limit);

  // E-mails come from the partner members the viewer may read (RLS): every
  // member for the platform, its own members for a partner.
  const actorIds = [
    ...new Set(
      page.flatMap((row) => (row.actor_user_id ? [row.actor_user_id] : [])),
    ),
  ];
  const members =
    actorIds.length > 0
      ? await tx.partnerMember.findMany({
          where: { userId: { in: actorIds } },
          select: { userId: true, email: true },
        })
      : [];
  const emails = new Map(members.map((m) => [m.userId, m.email]));

  return {
    events: page.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      action: row.action,
      result: row.result as SecurityEvent["result"],
      origin: row.origin,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_user_id
        ? (emails.get(row.actor_user_id) ?? null)
        : null,
      workspaceId: row.workspace_id,
      resourceType: row.resource_type,
    })),
    nextBefore:
      rows.length > limit && page.length > 0
        ? encodeAuditCursor({
            at: page[page.length - 1]!.cursor_at,
            id: page[page.length - 1]!.id,
          })
        : null,
  };
}
