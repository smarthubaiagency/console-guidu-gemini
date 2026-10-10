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

import type { WorkspaceJobDefinition } from "./definition";

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
