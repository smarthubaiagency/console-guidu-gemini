import { dispatchEvent } from "@/core/events/dispatch";
import { emitEvent, WORKER_ACTOR } from "@/core/events/emit";
import type { WorkspaceDeletionEventType } from "@/core/events/catalog";
import { getNotificationTransport } from "@/core/notifications/transport";
import type { NotificationTransport } from "@/core/notifications/types";
import { partnerConsoleOrigin } from "@/core/partners/console-origin";
import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Notices of a workspace deletion (WS1) through the Event Hub (H1): the
 * deletion was scheduled, 7 days are left, it was canceled, it is done.
 * Route `customer` (the workspace's active owners and admins, without
 * support memberships), e-mail and bell, essential. Sent by the worker
 * (app_worker) and dispatched at once in the same transaction, like the AI
 * key notices (A2c): the completed notice goes out before the purge
 * removes the members it is addressed to. The event's key is the deletion
 * record's plus the kind, so sending again is a no-op.
 */

export type DeletionNoticeKind =
  "scheduled" | "reminder" | "canceled" | "completed";

const TYPES: Readonly<Record<DeletionNoticeKind, WorkspaceDeletionEventType>> =
  {
    scheduled: "workspace.deletion.scheduled",
    reminder: "workspace.deletion.reminder",
    canceled: "workspace.deletion.canceled",
    completed: "workspace.deletion.completed",
  };

export type DeletionRecord = Readonly<{
  id: string;
  workspaceId: string;
  organizationId: string;
  workspaceName: string;
  purgeAfter: Date;
}>;

export type DeletionNoticeDeps = Readonly<{
  transport?: NotificationTransport;
}>;

/** Emits and dispatches one notice; returns the e-mails delivered. */
export async function sendDeletionNotice(
  tx: ContextTransaction,
  deletion: DeletionRecord,
  kind: DeletionNoticeKind,
  deps: DeletionNoticeDeps = {},
): Promise<number> {
  const organization = await tx.organization.findUnique({
    where: { id: deletion.organizationId },
    select: { partnerId: true },
  });
  const partnerId = organization?.partnerId;
  if (!partnerId) return 0;
  const origin = await partnerConsoleOrigin(tx, partnerId);
  const emitted = await emitEvent(tx, {
    type: TYPES[kind],
    actor: WORKER_ACTOR,
    partnerId,
    organizationId: deletion.organizationId,
    workspaceId: deletion.workspaceId,
    subject: { type: "workspace", id: deletion.workspaceId },
    data: {
      workspaceName: deletion.workspaceName,
      purgeAfter: deletion.purgeAfter.toISOString(),
      appUrl: new URL("/app", origin).toString(),
    },
    idempotencyKey: `workspace-deletion:${deletion.id}:${kind}`,
  });
  await recordNotice(tx, deletion.id, kind);
  if (!emitted.created) return 0;
  const result = await dispatchEvent(tx, emitted.id, {
    transport: deps.transport ?? getNotificationTransport(),
  });
  return result.notices;
}

/** Keeps when a notice was sent in the deletion record. */
async function recordNotice(
  tx: ContextTransaction,
  deletionId: string,
  kind: DeletionNoticeKind,
): Promise<void> {
  const at = new Date().toISOString();
  await tx.$executeRaw`
    update public.workspace_deletions
    set lifecycle = lifecycle || jsonb_build_object(
          'notices',
          coalesce(lifecycle -> 'notices', '{}'::jsonb) || jsonb_build_object(${kind}::text, ${at}::text)
        ),
        reminder_sent_at = case when ${kind}::text = 'reminder' then now() else reminder_sent_at end
    where id = ${deletionId}::uuid and purged_at is null
  `;
}

/** Days before the purge when the reminder goes out. */
export const REMINDER_DAYS = 7;

/**
 * The reminder of 7 days before the purge, once per deletion
 * (`reminder_sent_at`), from the daily privacy job.
 */
export async function sendDeletionReminders(
  tx: ContextTransaction,
  deps: DeletionNoticeDeps = {},
): Promise<number> {
  const due = await tx.$queryRaw<
    {
      id: string;
      workspace_id: string;
      organization_id: string;
      workspace_name: string;
      purge_after: Date;
    }[]
  >`
    select d.id, d.workspace_id, d.organization_id, d.workspace_name, d.purge_after
    from public.workspace_deletions d
    join public.workspaces w on w.id = d.workspace_id
    where d.canceled_at is null and d.purged_at is null
      and d.reminder_sent_at is null
      and w.status = 'deletion_scheduled'
      and d.purge_after > now()
      and d.purge_after <= now() + make_interval(days => ${REMINDER_DAYS}::integer)
    order by d.purge_after
    limit 100
  `;
  for (const row of due) {
    await sendDeletionNotice(
      tx,
      {
        id: row.id,
        workspaceId: row.workspace_id,
        organizationId: row.organization_id,
        workspaceName: row.workspace_name,
        purgeAfter: row.purge_after,
      },
      "reminder",
      deps,
    );
  }
  return due.length;
}
