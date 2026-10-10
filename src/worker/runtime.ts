import { PrismaClient } from "@prisma/client";
import { PgBoss, type Job } from "pg-boss";

import {
  DEAD_LETTER_QUEUE,
  type JobDefinition,
  queueName,
} from "@/core/jobs/definition";
import { classifyJobFailure, SkipJobError } from "@/core/jobs/errors";
import { listJobDefinitions } from "@/core/jobs/registry";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Job worker (ADR 0002, F3a). Runs in its own process as `app_worker`:
 *
 * 1. Dispatch: pending `job_runs` are sent to pg-boss with the run id as the
 *    job id, in the same transaction that marks them queued, so a crash
 *    never loses or duplicates a dispatch.
 * 2. Execute: for each job, one transaction locks the run, checks it is not
 *    already finished (effect at most once, delivery at least once), sets
 *    the requester's context, switches to `app_runtime` (decision 1a),
 *    re-checks the membership and runs the job through the same services
 *    as the web, then records the outcome as app_worker.
 * 3. Failures are classified: skip (access gone), fail (invalid), retry
 *    (backoff, then the dead-letter queue).
 *
 * One job per workspace runs at a time across every worker process: the
 * pg-boss group limit avoids most collisions, and a transaction advisory
 * lock per workspace guarantees it (pg-boss alone is racy between
 * processes; measured in tests/core/jobs.test.ts).
 */

export type WorkerOptions = Readonly<{
  /** Connection as app_worker (direct or session pooler). */
  databaseUrl: string;
  /** Jobs processed at the same time by this process. */
  concurrency?: number;
  dispatchIntervalMs?: number;
  pollingIntervalSeconds?: number;
  definitions?: readonly JobDefinition<unknown>[];
  instanceName?: string;
  log?: (event: Record<string, unknown>) => void;
}>;

export type JobWorker = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Dispatches pending runs now; returns how many were sent. */
  dispatchOnce(): Promise<number>;
}>;

type RunRow = {
  id: string;
  kind: string;
  scope: string;
  status: string;
  attempts: number;
  max_attempts: number;
  partner_id: string | null;
  organization_id: string | null;
  workspace_id: string | null;
  requested_by: string | null;
  payload: unknown;
};

const FINISHED = new Set(["succeeded", "skipped", "canceled", "failed"]);

function defaultLog(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", source: "worker", ...event }));
}

/** pg-boss's database adapter shape (not exported by the package). */
type IDatabase = {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
};

/** pg-boss adapter over a Prisma transaction (same connection, same commit). */
function prismaDb(tx: ContextTransaction): IDatabase {
  return {
    async executeSql(text: string, values: unknown[] = []) {
      const rows = await tx.$queryRawUnsafe<unknown[]>(text, ...values);
      return { rows: Array.isArray(rows) ? rows : [] };
    },
  };
}

export function createJobWorker(options: WorkerOptions): JobWorker {
  const log = options.log ?? defaultLog;
  const definitions = options.definitions ?? listJobDefinitions();
  const byKind = new Map(definitions.map((d) => [d.kind, d]));
  const prisma = new PrismaClient({
    datasources: { db: { url: options.databaseUrl } },
  });
  const boss = new PgBoss({
    connectionString: options.databaseUrl,
    schema: "pgboss",
    // The schema is installed and upgraded by versioned migrations only.
    migrate: false,
    createSchema: false,
    application_name: "guidu-worker",
    ...(options.instanceName ? { instanceName: options.instanceName } : {}),
  });
  boss.on("error", (error: Error) =>
    log({ level: "error", event: "pgboss.error", message: error.message }),
  );

  // The effect transaction may last as long as the longest job allows.
  const maxRunMs =
    Math.max(300, ...definitions.map((d) => d.expireInSeconds ?? 300)) * 1000;
  let dispatchTimer: NodeJS.Timeout | null = null;
  let dispatching: Promise<number> | null = null;
  let stopped = false;

  async function dispatchOnce(): Promise<number> {
    if (dispatching) return dispatching;
    dispatching = prisma
      .$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; kind: string; workspace_id: string | null }[]
        >`
          select id, kind, workspace_id
          from public.job_runs
          where status = 'pending' and run_after <= now()
          order by run_after
          limit 50
          for update skip locked
        `;
        let sent = 0;
        for (const row of rows) {
          const definition = byKind.get(row.kind);
          if (!definition) {
            await tx.$executeRaw`
              update public.job_runs
              set status = 'failed', last_error = 'Tipo de job desconhecido nesta versão.',
                  finished_at = now()
              where id = ${row.id}::uuid
            `;
            continue;
          }
          await boss.send(
            queueName(row.kind),
            { jobRunId: row.id },
            // No fixed job id: a retried run is dispatched again as a new
            // job; the row lock and this transaction keep it to one send.
            {
              group: { id: row.workspace_id ?? "platform" },
              db: prismaDb(tx),
            },
          );
          await tx.$executeRaw`
            update public.job_runs
            set status = 'queued', dispatched_at = now()
            where id = ${row.id}::uuid
          `;
          sent += 1;
        }
        return sent;
      })
      .finally(() => {
        dispatching = null;
      });
    return dispatching;
  }

  async function recordFailure(
    run: RunRow,
    action: "skip" | "fail" | "retry",
    message: string,
    lastAttempt: boolean,
  ): Promise<void> {
    const status =
      action === "skip"
        ? "skipped"
        : action === "fail" || lastAttempt
          ? "failed"
          : "queued";
    await prisma.$executeRaw`
      update public.job_runs
      set status = ${status},
          attempts = attempts + 1,
          last_error = ${message},
          finished_at = case when ${status} = 'queued' then null else now() end
      where id = ${run.id}::uuid and status not in ('succeeded', 'skipped', 'canceled')
    `;
  }

  async function execute(job: Job<{ jobRunId: string }>): Promise<void> {
    const jobRunId = job.data?.jobRunId;
    if (!jobRunId) return;
    let run: RunRow | null = null;
    try {
      await prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<RunRow[]>`
            select id, kind, scope, status, attempts, max_attempts, partner_id,
                   organization_id, workspace_id, requested_by, payload
            from public.job_runs
            where id = ${jobRunId}::uuid
            for update
          `;
          run = rows[0] ?? null;
          if (!run || FINISHED.has(run.status)) return; // at most once
          const definition = byKind.get(run.kind);
          if (!definition)
            throw new SkipJobError("Tipo de job desconhecido nesta versão.");
          if (
            run.scope !== "workspace" ||
            !run.workspace_id ||
            !run.organization_id ||
            !run.requested_by
          ) {
            throw new SkipJobError("Escopo de job não suportado.");
          }
          // One job per workspace at a time, across processes; waits for the
          // other job of the workspace to commit.
          await tx.$executeRaw`
            select pg_advisory_xact_lock(hashtext('job_workspace:' || ${run.workspace_id}))
          `;
          await tx.$executeRaw`
            update public.job_runs
            set status = 'running', started_at = now()
            where id = ${run.id}::uuid
          `;

          const ctx: RequestContext = {
            userId: run.requested_by,
            workspaceId: run.workspace_id,
            organizationId: run.organization_id,
            partnerId: run.partner_id,
            principalType: "user",
          };
          await tx.$executeRaw`
            select
              set_config('app.user_id', ${ctx.userId}, true),
              set_config('app.workspace_id', ${ctx.workspaceId}, true),
              set_config('app.organization_id', ${ctx.organizationId}, true),
              set_config('app.partner_id', ${ctx.partnerId ?? ""}, true),
              set_config('app.principal_type', 'user', true),
              set_config('app.grant_id', '', true)
          `;
          await tx.$executeRawUnsafe("set local role app_runtime");

          // Re-check before the effect: a member removed after the enqueue
          // has no role now, and the job stops here.
          if (!(await getEffectiveWorkspaceRole(tx, ctx))) {
            throw new SkipJobError(
              "Quem pediu a execução não tem mais acesso a este workspace.",
            );
          }
          const payload = definition.payload.safeParse(run.payload);
          if (!payload.success) {
            throw new SkipJobError("Dados do job inválidos para esta versão.");
          }
          const result = (await definition.run(tx, ctx, payload.data)) ?? null;

          await tx.$executeRawUnsafe("reset role");
          await tx.$executeRaw`
            update public.job_runs
            set status = 'succeeded', attempts = attempts + 1, finished_at = now(),
                last_error = null,
                result = ${result ? JSON.stringify(result) : null}::jsonb
            where id = ${jobRunId}::uuid
          `;
        },
        { timeout: maxRunMs, maxWait: 30_000 },
      );
      if (run) {
        log({ event: "job.succeeded", jobRunId, kind: (run as RunRow).kind });
      }
    } catch (error) {
      if (!run) throw error;
      const current = run as RunRow;
      const outcome = classifyJobFailure(error);
      const lastAttempt = job.retryCount + 1 >= current.max_attempts;
      await recordFailure(
        current,
        outcome.action,
        outcome.message,
        lastAttempt,
      );
      log({
        level: outcome.action === "retry" ? "warn" : "info",
        event: `job.${outcome.action}`,
        jobRunId,
        kind: current.kind,
        attempt: job.retryCount + 1,
      });
      // Only retryable failures go back to pg-boss (retry, then dead letter).
      if (outcome.action === "retry") throw error;
    }
  }

  async function start(): Promise<void> {
    stopped = false;
    await boss.start();
    await boss.createQueue(DEAD_LETTER_QUEUE, { retryLimit: 0 });
    for (const definition of definitions) {
      const name = queueName(definition.kind);
      const queue = {
        retryLimit: (definition.maxAttempts ?? 3) - 1,
        retryDelay: definition.retryDelaySeconds ?? 5,
        retryBackoff: true,
        expireInSeconds: definition.expireInSeconds ?? 300,
        deadLetter: DEAD_LETTER_QUEUE,
      };
      await boss.createQueue(name, queue);
      await boss.updateQueue(name, queue);
      await boss.work<{ jobRunId: string }>(
        name,
        {
          localConcurrency: options.concurrency ?? 4,
          groupConcurrency: 1,
          pollingIntervalSeconds: options.pollingIntervalSeconds ?? 1,
          batchSize: 1,
        },
        async (jobs) => {
          for (const job of jobs) await execute(job);
        },
      );
    }
    const interval = options.dispatchIntervalMs ?? 1000;
    const tick = async () => {
      if (stopped) return;
      try {
        await dispatchOnce();
      } catch (error) {
        log({
          level: "error",
          event: "dispatch.error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (!stopped) dispatchTimer = setTimeout(tick, interval);
    };
    dispatchTimer = setTimeout(tick, 0);
    log({ event: "worker.started", queues: definitions.map((d) => d.kind) });
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (dispatchTimer) clearTimeout(dispatchTimer);
    if (dispatching) await dispatching.catch(() => 0);
    await boss.stop({ graceful: true, timeout: 20_000 });
    await prisma.$disconnect();
    log({ event: "worker.stopped" });
  }

  return { start, stop, dispatchOnce };
}
