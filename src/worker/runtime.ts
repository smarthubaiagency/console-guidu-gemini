import { hostname } from "node:os";

import { PrismaClient } from "@prisma/client";
import { PgBoss, type Job } from "pg-boss";

import {
  DEAD_LETTER_QUEUE,
  type JobDefinition,
  type JobResult,
  type JobSchedule,
  queueName,
} from "@/core/jobs/definition";
import { classifyJobFailure, SkipJobError } from "@/core/jobs/errors";
import { listJobDefinitions, listJobSchedules } from "@/core/jobs/registry";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { createLogger, type LogLevel } from "@/lib/telemetry/log";

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
 *
 * Platform jobs (F3c) have no requester: they run as app_worker through
 * their own narrow policies, one run per kind at a time. The scheduler
 * inserts their runs with a key per period (`on conflict do nothing`), so
 * repeated ticks and several workers start each period once.
 *
 * Observability (F3d): a heartbeat per instance and queue metrics per job
 * kind go to tables only the platform reads (/platform/operations); `health`
 * answers the worker's live/ready probes; logs are structured JSON lines
 * with the jobId (docs/operacao/observabilidade.md).
 */

export type WorkerOptions = Readonly<{
  /** Connection as app_worker (direct or session pooler). */
  databaseUrl: string;
  /** Jobs processed at the same time by this process. */
  concurrency?: number;
  dispatchIntervalMs?: number;
  pollingIntervalSeconds?: number;
  definitions?: readonly JobDefinition<unknown>[];
  /** Recurring platform jobs; defaults to the registry's. */
  schedules?: readonly JobSchedule[];
  scheduleIntervalMs?: number;
  /** Clock of the scheduler (tests control it). */
  now?: () => Date;
  instanceName?: string;
  heartbeatIntervalMs?: number;
  metricsIntervalMs?: number;
  log?: (event: Record<string, unknown>) => void;
}>;

export type WorkerHealth = Readonly<{
  live: boolean;
  /** Started and the database answered recently. */
  ready: boolean;
  instanceName: string;
  lastDatabaseOkAt: Date | null;
}>;

export type JobWorker = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Dispatches pending runs now; returns how many were sent. */
  dispatchOnce(): Promise<number>;
  /** Inserts the due scheduled runs now; returns how many were new. */
  scheduleOnce(): Promise<number>;
  /** Records this instance as alive now. */
  heartbeatOnce(): Promise<void>;
  /** Publishes one snapshot of queue metrics; returns the rows written. */
  publishMetricsOnce(): Promise<number>;
  health(): WorkerHealth;
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

const workerLog = createLogger("worker");
const LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

function defaultLog(entry: Record<string, unknown>): void {
  const { level, event, ...fields } = entry;
  const lvl = LEVELS.has(level as LogLevel) ? (level as LogLevel) : "info";
  workerLog[lvl](typeof event === "string" ? event : "worker.event", fields);
}

/** Default instance name: the host name, as the heartbeat table accepts. */
function defaultInstanceName(): string {
  const name = hostname()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 63);
  return name || "worker";
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
  const schedules = (options.schedules ?? listJobSchedules()).filter((s) =>
    byKind.has(s.kind),
  );
  const clock = options.now ?? (() => new Date());
  const instanceName = options.instanceName ?? defaultInstanceName();
  const startedAt = new Date();
  let started = false;
  let lastDatabaseOkAt: Date | null = null;
  const heartbeatInterval = options.heartbeatIntervalMs ?? 30_000;
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
    instanceName,
  });
  boss.on("error", (error: Error) =>
    log({ level: "error", event: "pgboss.error", message: error.message }),
  );

  // The effect transaction may last as long as the longest job allows.
  const maxRunMs =
    Math.max(300, ...definitions.map((d) => d.expireInSeconds ?? 300)) * 1000;
  let dispatchTimer: NodeJS.Timeout | null = null;
  let scheduleTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let metricsTimer: NodeJS.Timeout | null = null;
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

  async function scheduleOnce(): Promise<number> {
    const now = clock();
    let created = 0;
    for (const schedule of schedules) {
      const due = schedule.due(now);
      if (!due) continue;
      const definition = byKind.get(schedule.kind);
      const inserted = await prisma.$executeRaw`
        insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts)
        values (${schedule.kind}, 'platform', ${JSON.stringify(due.payload)}::jsonb,
                ${due.key}, ${definition?.maxAttempts ?? 3})
        on conflict (kind, idempotency_key) do nothing
      `;
      if (inserted > 0) {
        created += inserted;
        log({ event: "job.scheduled", kind: schedule.kind, key: due.key });
      }
    }
    return created;
  }

  async function heartbeatOnce(status: "running" | "stopped" = "running") {
    await prisma.$executeRaw`
      insert into public.worker_heartbeats
        (instance_name, started_at, last_seen_at, status, concurrency, queues, version)
      values (${instanceName}, ${startedAt}, now(), ${status},
              ${options.concurrency ?? 4}, ${definitions.length},
              ${process.env.GUIDU_VERSION ?? null})
      on conflict (instance_name) do update
      set started_at = excluded.started_at, last_seen_at = now(),
          status = excluded.status, concurrency = excluded.concurrency,
          queues = excluded.queues, version = excluded.version
    `;
    lastDatabaseOkAt = new Date();
  }

  async function publishMetricsOnce(): Promise<number> {
    const kinds = definitions.map((d) => d.kind);
    if (kinds.length === 0) return 0;
    const queues = kinds.map(queueName);
    const written = await prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        with kinds as (select unnest(${kinds}::text[]) as kind),
        runs as (
          select kind,
            count(*) filter (where status = 'pending') as pending,
            count(*) filter (where status = 'queued') as queued,
            count(*) filter (where status = 'running') as running,
            count(*) filter (where status = 'succeeded' and finished_at >= now() - interval '24 hours') as succeeded_24h,
            count(*) filter (where status = 'failed' and finished_at >= now() - interval '24 hours') as failed_24h,
            count(*) filter (where status = 'skipped' and finished_at >= now() - interval '24 hours') as skipped_24h,
            extract(epoch from now() - min(created_at) filter (where status = 'pending'))::integer
              as oldest_pending_seconds,
            (avg(extract(epoch from finished_at - started_at) * 1000)
              filter (where status = 'succeeded' and finished_at >= now() - interval '24 hours'
                      and started_at is not null))::integer as avg_ms,
            (percentile_cont(0.95) within group (order by extract(epoch from finished_at - started_at) * 1000)
              filter (where status = 'succeeded' and finished_at >= now() - interval '24 hours'
                      and started_at is not null))::integer as p95_ms
          from public.job_runs
          where kind = any(${kinds}::text[])
            and (status in ('pending', 'queued', 'running') or finished_at >= now() - interval '24 hours')
          group by kind
        ),
        boss as (
          select name,
            count(*) filter (where state in ('created', 'retry')) as waiting,
            count(*) filter (where state = 'active') as active
          from pgboss.job
          where name = any(${queues}::text[])
          group by name
        )
        insert into public.queue_metrics
          (instance_name, kind, pending, queued, running, succeeded_24h, failed_24h,
           skipped_24h, oldest_pending_seconds, avg_duration_ms_24h, p95_duration_ms_24h,
           boss_waiting, boss_active)
        select ${instanceName}, k.kind,
               coalesce(r.pending, 0), coalesce(r.queued, 0), coalesce(r.running, 0),
               coalesce(r.succeeded_24h, 0), coalesce(r.failed_24h, 0), coalesce(r.skipped_24h, 0),
               greatest(r.oldest_pending_seconds, 0), r.avg_ms, r.p95_ms,
               coalesce(b.waiting, 0), coalesce(b.active, 0)
        from kinds k
        left join runs r on r.kind = k.kind
        left join boss b on b.name = 'job/' || k.kind
      `;
      // Retention of 7 days (the policy allows deleting only older rows).
      await tx.$executeRaw`
        delete from public.queue_metrics where captured_at < now() - interval '7 days'
      `;
      return inserted;
    });
    lastDatabaseOkAt = new Date();
    return written;
  }

  function health(): WorkerHealth {
    const fresh =
      lastDatabaseOkAt !== null &&
      Date.now() - lastDatabaseOkAt.getTime() <= heartbeatInterval * 3;
    return {
      live: true,
      ready: started && !stopped && fresh,
      instanceName,
      lastDatabaseOkAt,
    };
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

  async function markRunning(
    tx: ContextTransaction,
    id: string,
  ): Promise<void> {
    await tx.$executeRaw`
      update public.job_runs
      set status = 'running', started_at = now()
      where id = ${id}::uuid
    `;
  }

  async function markSucceeded(
    tx: ContextTransaction,
    id: string,
    result: JobResult | null,
  ): Promise<void> {
    await tx.$executeRaw`
      update public.job_runs
      set status = 'succeeded', attempts = attempts + 1, finished_at = now(),
          last_error = null,
          result = ${result ? JSON.stringify(result) : null}::jsonb
      where id = ${id}::uuid
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
          if (run.scope === "platform" && definition.scope === "platform") {
            // One run of each platform job at a time, across processes.
            await tx.$executeRaw`
              select pg_advisory_xact_lock(hashtext('job_platform:' || ${run.kind}))
            `;
            await markRunning(tx, run.id);
            const payload = definition.payload.safeParse(run.payload);
            if (!payload.success) {
              throw new SkipJobError(
                "Dados do job inválidos para esta versão.",
              );
            }
            const result = (await definition.run(tx, payload.data)) ?? null;
            await markSucceeded(tx, run.id, result);
            return;
          }
          if (
            run.scope !== "workspace" ||
            definition.scope !== "workspace" ||
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
          await markRunning(tx, run.id);

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
          await markSucceeded(tx, run.id, result);
        },
        { timeout: maxRunMs, maxWait: 30_000 },
      );
      if (run) {
        log({
          event: "job.succeeded",
          jobId: jobRunId,
          kind: (run as RunRow).kind,
        });
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
        jobId: jobRunId,
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
    await heartbeatOnce();
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
        lastDatabaseOkAt = new Date();
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

    const scheduleInterval = options.scheduleIntervalMs ?? 60_000;
    const scheduleTick = async () => {
      if (stopped) return;
      try {
        await scheduleOnce();
      } catch (error) {
        log({
          level: "error",
          event: "schedule.error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (!stopped) scheduleTimer = setTimeout(scheduleTick, scheduleInterval);
    };
    if (schedules.length > 0) scheduleTimer = setTimeout(scheduleTick, 0);

    const repeat = (
      name: string,
      intervalMs: number,
      run: () => Promise<unknown>,
      set: (timer: NodeJS.Timeout) => void,
    ) => {
      const tick = async () => {
        if (stopped) return;
        try {
          await run();
        } catch (error) {
          log({
            level: "error",
            event: `${name}.error`,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        if (!stopped) set(setTimeout(tick, intervalMs));
      };
      set(setTimeout(tick, intervalMs));
    };
    repeat("heartbeat", heartbeatInterval, heartbeatOnce, (t) => {
      heartbeatTimer = t;
    });
    repeat(
      "metrics",
      options.metricsIntervalMs ?? 60_000,
      publishMetricsOnce,
      (t) => {
        metricsTimer = t;
      },
    );
    started = true;
    log({
      event: "worker.started",
      instanceName,
      queues: definitions.map((d) => d.kind),
    });
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (dispatchTimer) clearTimeout(dispatchTimer);
    if (scheduleTimer) clearTimeout(scheduleTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (metricsTimer) clearTimeout(metricsTimer);
    if (dispatching) await dispatching.catch(() => 0);
    await boss.stop({ graceful: true, timeout: 20_000 });
    if (started) {
      await heartbeatOnce("stopped").catch(() => undefined);
    }
    started = false;
    await prisma.$disconnect();
    log({ event: "worker.stopped" });
  }

  return {
    start,
    stop,
    dispatchOnce,
    scheduleOnce,
    heartbeatOnce: () => heartbeatOnce(),
    publishMetricsOnce,
    health,
  };
}
