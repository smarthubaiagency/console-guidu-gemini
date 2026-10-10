import { PermissionDeniedError } from "@/core/permissions/guard";
import { Permissions } from "@/core/permissions/catalog";
import {
  hasPlatformRolePermission,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Operations overview (F3d, /platform/operations): worker heartbeats, the
 * latest queue snapshot per job kind, recent failures and the job volume of
 * the last 24 hours. Every number carries its sample; nothing is invented
 * when the worker has not published yet ("Sem dados"). RLS repeats the
 * permission: only owner, operations and support read these tables.
 */

export type OperationsActor = Readonly<{
  userId: string;
  platformRole: PlatformAdminRoleKey | null;
}>;

export function canReadOperations(actor: OperationsActor): boolean {
  return Boolean(
    actor.platformRole &&
    hasPlatformRolePermission(
      actor.platformRole,
      Permissions.PLATFORM_OPERATIONS_READ,
    ),
  );
}

/** A worker without a heartbeat for this long is shown as silent. */
export const WORKER_SILENT_AFTER_MS = 2 * 60_000;
/** Snapshots older than this are flagged as stale on the page. */
export const METRICS_STALE_AFTER_MS = 5 * 60_000;

export type WorkerView = Readonly<{
  instanceName: string;
  state: "online" | "stopped" | "silent";
  startedAt: Date;
  lastSeenAt: Date;
  concurrency: number;
  queues: number;
  version: string | null;
}>;

export type QueueView = Readonly<{
  kind: string;
  pending: number;
  queued: number;
  running: number;
  succeeded24h: number;
  failed24h: number;
  skipped24h: number;
  /** Finished runs of the last 24 hours behind the durations. */
  sample24h: number;
  oldestPendingSeconds: number | null;
  avgDurationMs24h: number | null;
  p95DurationMs24h: number | null;
  bossWaiting: number;
  bossActive: number;
}>;

export type FailureView = Readonly<{
  id: string;
  kind: string;
  scope: string;
  workspaceId: string | null;
  attempts: number;
  lastError: string | null;
  finishedAt: Date | null;
}>;

export type OperationsOverview = Readonly<{
  generatedAt: Date;
  workers: WorkerView[];
  metrics: Readonly<{
    capturedAt: Date | null;
    stale: boolean;
    queues: QueueView[];
    totals: Readonly<{
      waiting: number;
      running: number;
      succeeded24h: number;
      failed24h: number;
      skipped24h: number;
      sample24h: number;
    }>;
  }>;
  failures: FailureView[];
}>;

export function workerState(
  row: Readonly<{ status: string; lastSeenAt: Date }>,
  now: Date,
): WorkerView["state"] {
  if (row.status === "stopped") return "stopped";
  return now.getTime() - row.lastSeenAt.getTime() <= WORKER_SILENT_AFTER_MS
    ? "online"
    : "silent";
}

export async function getOperationsOverview(
  tx: ContextTransaction,
  actor: OperationsActor,
  now: Date = new Date(),
): Promise<OperationsOverview> {
  if (!canReadOperations(actor)) throw new PermissionDeniedError();

  const [heartbeats, latest, failures] = await Promise.all([
    tx.workerHeartbeat.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: 20,
    }),
    tx.queueMetric.findFirst({
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    }),
    tx.jobRun.findMany({
      where: {
        status: "failed",
        finishedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      },
      orderBy: { finishedAt: "desc" },
      take: 20,
      select: {
        id: true,
        kind: true,
        scope: true,
        workspaceId: true,
        attempts: true,
        lastError: true,
        finishedAt: true,
      },
    }),
  ]);

  // The newest snapshot of each kind, from the last round of captures
  // (several workers publish close to each other).
  const rows = latest
    ? await tx.queueMetric.findMany({
        where: {
          capturedAt: {
            gte: new Date(latest.capturedAt.getTime() - 2 * 60_000),
          },
        },
        orderBy: { capturedAt: "desc" },
        take: 500,
      })
    : [];
  const byKind = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byKind.has(row.kind)) byKind.set(row.kind, row);
  const queues: QueueView[] = [...byKind.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map((row) => ({
      kind: row.kind,
      pending: row.pending,
      queued: row.queued,
      running: row.running,
      succeeded24h: row.succeeded24h,
      failed24h: row.failed24h,
      skipped24h: row.skipped24h,
      sample24h: row.succeeded24h,
      oldestPendingSeconds: row.oldestPendingSeconds,
      avgDurationMs24h: row.avgDurationMs24h,
      p95DurationMs24h: row.p95DurationMs24h,
      bossWaiting: row.bossWaiting,
      bossActive: row.bossActive,
    }));
  const sum = (pick: (q: QueueView) => number) =>
    queues.reduce((total, q) => total + pick(q), 0);

  return {
    generatedAt: now,
    workers: heartbeats.map((row) => ({
      instanceName: row.instanceName,
      state: workerState(row, now),
      startedAt: row.startedAt,
      lastSeenAt: row.lastSeenAt,
      concurrency: row.concurrency,
      queues: row.queues,
      version: row.version,
    })),
    metrics: {
      capturedAt: latest?.capturedAt ?? null,
      stale: latest
        ? now.getTime() - latest.capturedAt.getTime() > METRICS_STALE_AFTER_MS
        : false,
      queues,
      totals: {
        waiting: sum((q) => q.pending + q.queued),
        running: sum((q) => q.running),
        succeeded24h: sum((q) => q.succeeded24h),
        failed24h: sum((q) => q.failed24h),
        skipped24h: sum((q) => q.skipped24h),
        sample24h: sum((q) => q.succeeded24h + q.failed24h + q.skipped24h),
      },
    },
    failures,
  };
}

/** "há 3 min", "há 2 h": age of a timestamp for the page. */
export function ageLabel(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - from.getTime()) / 1000),
  );
  if (seconds < 60) return `há ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

/** Duration in ms as "820 ms" or "3,4 s"; null as "—". */
export function durationLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
}
