import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Queueing of the deletion lifecycle runs (WS1), apart from the jobs
 * themselves so the request, the cancel and the daily job import no job
 * code. See lifecycle-jobs.ts.
 */

export const WORKSPACE_LIFECYCLE_JOB_KIND = "privacy.workspace-lifecycle";
export const WORKSPACE_PURGE_JOB_KIND = "privacy.workspace-purge";

/**
 * Queues the purge of a workspace past its grace period (daily privacy
 * job, app_worker): one run per day, never two in flight.
 */
export async function enqueueWorkspacePurge(
  tx: ContextTransaction,
  workspaceId: string,
  date: string,
): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts)
    select ${WORKSPACE_PURGE_JOB_KIND}, 'platform',
           ${JSON.stringify({ workspaceId })}::jsonb,
           ${`purge:${workspaceId}:${date}`}, 5
    where not exists (
      select 1 from public.job_runs r
      where r.kind = ${WORKSPACE_PURGE_JOB_KIND}
        and r.payload ->> 'workspaceId' = ${workspaceId}
        and r.status in ('pending', 'queued', 'running')
    )
    on conflict (kind, idempotency_key) do nothing
  `;
  return inserted > 0;
}

/**
 * Queues the lifecycle run of a deletion from the web (app_runtime), in
 * the transaction of the request or the cancel; the database allows it
 * only for the deletion the caller has just requested or canceled.
 */
export async function enqueueWorkspaceLifecycle(
  tx: ContextTransaction,
  userId: string,
  deletionId: string,
  action: "scheduled" | "canceled",
): Promise<void> {
  await tx.$executeRaw`
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key, max_attempts)
    values (${WORKSPACE_LIFECYCLE_JOB_KIND}, 'platform', ${userId}::uuid,
            ${JSON.stringify({ deletionId, action })}::jsonb,
            ${`${action}:${deletionId}`}, 5)
  `;
}
