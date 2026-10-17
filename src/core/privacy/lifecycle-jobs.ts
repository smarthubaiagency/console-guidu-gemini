import { z } from "zod";

import {
  defineDetachedPlatformJob,
  type PlatformJobSession,
} from "@/core/jobs/definition";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import {
  type LifecyclePhase,
  type PhaseHook,
  type PhaseRecords,
  type PhaseStore,
  runLifecyclePhase,
} from "./lifecycle";
import {
  listLifecycleHooks,
  type NamedLifecycleHooks,
} from "./lifecycle-registry";
import {
  WORKSPACE_LIFECYCLE_JOB_KIND,
  WORKSPACE_PURGE_JOB_KIND,
} from "./lifecycle-queue";
import { purgeWorkspace } from "./maintenance";
import {
  type DeletionNoticeDeps,
  type DeletionRecord,
  sendDeletionNotice,
} from "./notices";

/**
 * Jobs of the workspace deletion's lifecycle (WS1), platform jobs run by
 * the worker as app_worker with short transactions of their own:
 *
 * - `privacy.workspace-lifecycle`: queued by the request and by the cancel,
 *   in their transaction. Runs the `onDeletionScheduled` or
 *   `onDeletionCanceled` hooks, each in its own transaction, then sends the
 *   notice. A failed hook is retried with the run; the ones already done
 *   are not repeated.
 * - `privacy.workspace-purge`: queued by the daily privacy job for a
 *   workspace past its grace period. Runs every `purgeExternal` hook
 *   outside any transaction, recording each result; only when all of them
 *   succeeded, one transaction sends the completed notice and purges the
 *   database (module contracts, core rows, tombstone). A failed hook fails
 *   the run, which is retried with backoff and again by the next day's job.
 */

/** Longest transaction of the database purge (a large workspace). */
const PURGE_TRANSACTION_MS = 600_000;

const LifecyclePayload = z.strictObject({
  deletionId: z.uuid(),
  action: z.enum(["scheduled", "canceled"]),
});
const PurgePayload = z.strictObject({ workspaceId: z.uuid() });

type DeletionRow = {
  id: string;
  workspace_id: string;
  organization_id: string;
  workspace_name: string;
  purge_after: Date;
  canceled_at: Date | null;
  purged_at: Date | null;
};

function recordOf(row: DeletionRow): DeletionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    workspaceName: row.workspace_name,
    purgeAfter: row.purge_after,
  };
}

/** Results of one phase, kept in `workspace_deletions.lifecycle`. */
export function deletionPhaseStore(
  session: Pick<PlatformJobSession, "transaction">,
  deletionId: string,
  phase: LifecyclePhase,
): PhaseStore {
  return {
    async read() {
      const [row] = await session.transaction(
        (tx) =>
          tx.$queryRaw<{ records: PhaseRecords | null }[]>`
          select lifecycle -> ${phase}::text as records
          from public.workspace_deletions where id = ${deletionId}::uuid
        `,
      );
      return row?.records ?? {};
    },
    async write(key, record) {
      await session.transaction(
        (tx) => tx.$executeRaw`
          update public.workspace_deletions
          set lifecycle = lifecycle || jsonb_build_object(
                ${phase}::text,
                coalesce(lifecycle -> ${phase}::text, '{}'::jsonb)
                  || jsonb_build_object(${key}::text, ${JSON.stringify(record)}::jsonb)
              )
          where id = ${deletionId}::uuid and purged_at is null
        `,
      );
    },
  };
}

/** The hooks of a phase, as the runner calls them. */
export function phaseHooks(
  hooks: readonly NamedLifecycleHooks[],
  phase: LifecyclePhase,
  workspaceId: string,
  session: Pick<PlatformJobSession, "transaction">,
): PhaseHook[] {
  return hooks.flatMap((hook): PhaseHook[] => {
    if (phase === "external") {
      const purge = hook.purgeExternal;
      return purge
        ? [{ key: hook.key, run: () => purge(workspaceId, session) }]
        : [];
    }
    const run =
      phase === "scheduled"
        ? hook.onDeletionScheduled
        : hook.onDeletionCanceled;
    return run
      ? [
          {
            key: hook.key,
            run: () => session.transaction((tx) => run(tx, workspaceId)),
          },
        ]
      : [];
  });
}

async function loadDeletion(
  tx: ContextTransaction,
  deletionId: string,
): Promise<DeletionRow | null> {
  const [row] = await tx.$queryRaw<DeletionRow[]>`
    select id, workspace_id, organization_id, workspace_name, purge_after,
           canceled_at, purged_at
    from public.workspace_deletions where id = ${deletionId}::uuid
  `;
  return row ?? null;
}

async function noticeSent(
  tx: ContextTransaction,
  deletionId: string,
  kind: string,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ sent: boolean }[]>`
    select (lifecycle -> 'notices' ? ${kind}::text) as sent
    from public.workspace_deletions where id = ${deletionId}::uuid
  `;
  return row?.sent === true;
}

export type LifecycleJobDeps = DeletionNoticeDeps &
  Readonly<{ hooks?: () => readonly NamedLifecycleHooks[] }>;

export async function runWorkspaceLifecycle(
  session: Pick<PlatformJobSession, "transaction">,
  payload: z.infer<typeof LifecyclePayload>,
  deps: LifecycleJobDeps = {},
): Promise<Record<string, string | number>> {
  const deletion = await session.transaction((tx) =>
    loadDeletion(tx, payload.deletionId),
  );
  if (!deletion || deletion.purged_at) return { status: "gone" };
  // A cancel that came first wins over a late scheduled run.
  const current =
    payload.action === "scheduled"
      ? deletion.canceled_at === null
      : deletion.canceled_at !== null;
  if (!current) return { status: "superseded" };

  const hooks = (deps.hooks ?? listLifecycleHooks)();
  const phase = await runLifecyclePhase(
    phaseHooks(hooks, payload.action, deletion.workspace_id, session),
    deletionPhaseStore(session, deletion.id, payload.action),
  );
  const notices = await session.transaction(async (tx) => {
    if (await noticeSent(tx, deletion.id, payload.action)) return 0;
    return sendDeletionNotice(tx, recordOf(deletion), payload.action, deps);
  });
  if (!phase.ok) {
    throw new Error(`Ganchos com falha: ${phase.failed.join(", ")}.`);
  }
  return { status: "done", hooks: phase.ran, notices };
}

/** The open deletion of a workspace past its grace period, or null. */
async function dueDeletion(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<DeletionRow | null> {
  const [row] = await tx.$queryRaw<DeletionRow[]>`
    select d.id, d.workspace_id, d.organization_id, d.workspace_name, d.purge_after,
           d.canceled_at, d.purged_at
    from public.workspace_deletions d
    join public.workspaces w on w.id = d.workspace_id
    where d.workspace_id = ${workspaceId}::uuid
      and d.canceled_at is null and d.purged_at is null
      and w.status = 'deletion_scheduled' and w.purge_after <= now()
    limit 1
  `;
  return row ?? null;
}

export async function runWorkspacePurge(
  session: Pick<PlatformJobSession, "transaction">,
  payload: z.infer<typeof PurgePayload>,
  deps: LifecycleJobDeps = {},
): Promise<Record<string, string | number>> {
  const deletion = await session.transaction((tx) =>
    dueDeletion(tx, payload.workspaceId),
  );
  if (!deletion) return { status: "not_due" };

  // 1. Outside the database, before it (idempotent, retried on failure).
  const hooks = (deps.hooks ?? listLifecycleHooks)();
  const external = await runLifecyclePhase(
    phaseHooks(hooks, "external", deletion.workspace_id, session),
    deletionPhaseStore(session, deletion.id, "external"),
  );
  if (!external.ok) {
    throw new Error(
      `Limpeza externa pendente: ${external.failed.join(", ")}. A limpeza do banco espera.`,
    );
  }

  // 2. The database, once every external hook succeeded.
  const summary = await session.transaction(
    async (tx) => {
      await tx.$executeRaw`
        select pg_advisory_xact_lock(hashtext('workspace_purge:' || ${deletion.workspace_id}))
      `;
      const still = await dueDeletion(tx, deletion.workspace_id);
      if (!still) return null;
      await sendDeletionNotice(tx, recordOf(still), "completed", deps);
      return purgeWorkspace(tx, {
        id: still.workspace_id,
        organizationId: still.organization_id,
      });
    },
    { timeoutMs: PURGE_TRANSACTION_MS },
  );
  if (!summary) return { status: "not_due" };
  return {
    status: "purged",
    external: Object.keys(external.records).length,
    tables: Object.keys(summary).length,
  };
}

export function createWorkspaceLifecycleJob(deps: LifecycleJobDeps = {}) {
  return defineDetachedPlatformJob<z.infer<typeof LifecyclePayload>>({
    kind: WORKSPACE_LIFECYCLE_JOB_KIND,
    description:
      "Executa os ganchos e envia o aviso de quando a exclusão de um workspace é agendada ou cancelada.",
    payload: LifecyclePayload,
    maxAttempts: 5,
    retryDelaySeconds: 30,
    expireInSeconds: 300,
    run: (session, payload) => runWorkspaceLifecycle(session, payload, deps),
  });
}

export function createWorkspacePurgeJob(deps: LifecycleJobDeps = {}) {
  return defineDetachedPlatformJob<z.infer<typeof PurgePayload>>({
    kind: WORKSPACE_PURGE_JOB_KIND,
    description:
      "Conclui a exclusão de um workspace: limpa o que está fora do banco e depois os dados.",
    payload: PurgePayload,
    maxAttempts: 5,
    retryDelaySeconds: 300,
    expireInSeconds: 900,
    run: (session, payload) => runWorkspacePurge(session, payload, deps),
  });
}

export const workspaceLifecycleJob = createWorkspaceLifecycleJob();
export const workspacePurgeJob = createWorkspacePurgeJob();
