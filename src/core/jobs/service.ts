import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { recordAudit } from "@/core/audit/record";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import type {
  PlatformJobDefinition,
  WorkspaceJobDefinition,
} from "./definition";

/**
 * Web side of jobs (F3a, decision 2): the job is a row of `job_runs`
 * written in the caller's transaction, so it exists only if the action
 * commits. The worker dispatches it to the queue; the web never touches
 * the queue schema.
 */

export const JOB_RUN_STATUSES = [
  "pending",
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "canceled",
] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export type JobRunView = Readonly<{
  id: string;
  kind: string;
  status: JobRunStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  requestedByMe: boolean;
}>;

export async function enqueueJob<P>(
  tx: ContextTransaction,
  ctx: RequestContext,
  definition: WorkspaceJobDefinition<P>,
  payload: P,
  options: Readonly<{ idempotencyKey?: string; runAfter?: Date }> = {},
): Promise<{ id: string; created: boolean }> {
  const parsed = definition.payload.safeParse(payload);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Dados do job inválidos.",
      messageKey: "executions.errors.invalidJobData",
    });
  }
  const idempotencyKey = options.idempotencyKey ?? randomUUID();
  try {
    const run = await tx.jobRun.create({
      data: {
        kind: definition.kind,
        scope: "workspace",
        partnerId: ctx.partnerId || null,
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        requestedBy: ctx.userId,
        payload: parsed.data as Prisma.InputJsonValue,
        idempotencyKey,
        maxAttempts: definition.maxAttempts ?? 3,
        ...(options.runAfter ? { runAfter: options.runAfter } : {}),
      },
      select: { id: true },
    });
    return { id: run.id, created: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await tx.jobRun.findFirst({
        where: { kind: definition.kind, idempotencyKey },
        select: { id: true },
      });
      if (existing) return { id: existing.id, created: false };
    }
    throw error;
  }
}

/**
 * Platform job asked from the web (I6): only the kinds the `job_runs`
 * policies open to app_runtime (machine translation) can be inserted, by
 * whom those policies allow. One run in flight per `subject` (a language or
 * a document): an advisory lock serialises concurrent requests and a
 * pending, queued or running run with the same subject is refused.
 */
export async function enqueuePlatformJob<P extends Record<string, unknown>>(
  tx: ContextTransaction,
  requestedBy: string,
  definition: PlatformJobDefinition<P>,
  payload: P,
  options: Readonly<{
    partnerId?: string | null;
    /** Payload field that identifies the subject, e.g. `locale`. */
    subjectField: keyof P & string;
  }>,
): Promise<{ id: string }> {
  const parsed = definition.payload.safeParse(payload);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Dados do job inválidos.",
      messageKey: "executions.errors.invalidJobData",
    });
  }
  const subject = String(payload[options.subjectField]);
  await tx.$executeRaw`
    select pg_advisory_xact_lock(hashtext(${`job_subject:${definition.kind}:${subject}`}))
  `;
  const inFlight = await tx.jobRun.findFirst({
    where: {
      kind: definition.kind,
      status: { in: ["pending", "queued", "running"] },
      payload: { path: [options.subjectField], equals: subject },
    },
    select: { id: true },
  });
  if (inFlight) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Já existe uma execução em andamento para este item.",
      messageKey: "executions.errors.alreadyRunning",
    });
  }
  const run = await tx.jobRun.create({
    data: {
      kind: definition.kind,
      scope: "platform",
      partnerId: options.partnerId ?? null,
      requestedBy,
      payload: parsed.data as Prisma.InputJsonValue,
      idempotencyKey: `${subject}:${randomUUID()}`.slice(0, 200),
      maxAttempts: definition.maxAttempts ?? 3,
    },
    select: { id: true },
  });
  return run;
}

/** Latest run of a platform job for one subject, or null. */
export async function latestPlatformRun(
  tx: ContextTransaction,
  kind: string,
  subjectField: string,
  subject: string,
): Promise<PlatformRunView | null> {
  const row = await tx.jobRun.findFirst({
    where: { kind, payload: { path: [subjectField], equals: subject } },
    orderBy: { createdAt: "desc" },
    select: platformRunSelect,
  });
  return row ? toPlatformRunView(row) : null;
}

export type PlatformRunView = Readonly<{
  id: string;
  status: JobRunStatus;
  lastError: string | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
  finishedAt: Date | null;
  payload: Record<string, unknown>;
}>;

export const platformRunSelect = {
  id: true,
  status: true,
  lastError: true,
  result: true,
  createdAt: true,
  finishedAt: true,
  payload: true,
} as const;

export function toPlatformRunView(row: {
  id: string;
  status: string;
  lastError: string | null;
  result: Prisma.JsonValue;
  createdAt: Date;
  finishedAt: Date | null;
  payload: Prisma.JsonValue;
}): PlatformRunView {
  const obj = (v: Prisma.JsonValue) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    status: (JOB_RUN_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as JobRunStatus)
      : "pending",
    lastError: row.lastError,
    result: obj(row.result),
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    payload: obj(row.payload) ?? {},
  };
}

function toView(
  row: {
    id: string;
    kind: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    result: Prisma.JsonValue;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    requestedBy: string | null;
  },
  ctx: RequestContext,
): JobRunView {
  return {
    id: row.id,
    kind: row.kind,
    status: (JOB_RUN_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as JobRunStatus)
      : "pending",
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    result:
      row.result && typeof row.result === "object" && !Array.isArray(row.result)
        ? (row.result as Record<string, unknown>)
        : null,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    requestedByMe: row.requestedBy === ctx.userId,
  };
}

/** Runs of the context workspace, newest first. */
export async function listWorkspaceJobRuns(
  tx: ContextTransaction,
  ctx: RequestContext,
  take = 50,
): Promise<JobRunView[]> {
  await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_READ);
  const rows = await tx.jobRun.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      kind: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      result: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      requestedBy: true,
    },
  });
  return rows.map((row) => toView(row, ctx));
}

/** A failed run goes back to the queue with fresh attempts (owner/admin). */
export async function retryJobRun(
  tx: ContextTransaction,
  ctx: RequestContext,
  jobRunId: string,
): Promise<void> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_SETTINGS_UPDATE,
  );
  const updated = await tx.jobRun.updateMany({
    where: { id: jobRunId, workspaceId: ctx.workspaceId, status: "failed" },
    data: {
      status: "pending",
      attempts: 0,
      lastError: null,
      runAfter: new Date(),
      dispatchedAt: null,
      startedAt: null,
      finishedAt: null,
    },
  });
  if (updated.count === 0) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Só execuções com falha podem ser reprocessadas.",
      messageKey: "executions.errors.onlyFailedRetry",
    });
  }
  await recordAudit(tx, ctx, {
    action: "job.retry",
    resourceType: "job_run",
    resourceId: jobRunId,
    result: "success",
    metadata: { from: "failed", to: "pending" },
  });
}
