import "server-only";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { enqueueJob } from "@/core/jobs/service";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  HELLO_WORLD_DEMO_RECORD_LIMIT,
  HelloWorldPermissions,
} from "../../manifest";

const MODULE_KEY = "hello-world";

export type HelloWorldRecordDto = Readonly<{
  id: string;
  title: string;
  createdAt: string;
  createdByMe: boolean;
}>;

export const CreateRecordInput = z.object({
  title: z.string().trim().min(1).max(120),
});

function toDto(
  row: { id: string; title: string; createdAt: Date; createdBy: string },
  ctx: RequestContext,
): HelloWorldRecordDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    createdByMe: row.createdBy === ctx.userId,
  };
}

/** Lists the workspace records (RLS scopes rows to the context workspace). */
export async function listHelloWorldRecords(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<{ records: HelloWorldRecordDto[]; limit: number }> {
  await assertModuleOperational(tx, ctx, MODULE_KEY);
  await requireWorkspacePermission(tx, ctx, HelloWorldPermissions.READ);
  const rows = await tx.helloWorldRecord.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: HELLO_WORLD_DEMO_RECORD_LIMIT,
  });
  return {
    records: rows.map((row) => toDto(row, ctx)),
    limit: HELLO_WORLD_DEMO_RECORD_LIMIT,
  };
}

/** One record of the context workspace; other workspaces' ids are not found. */
export async function getHelloWorldRecord(
  tx: ContextTransaction,
  ctx: RequestContext,
  recordId: string,
): Promise<HelloWorldRecordDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY);
  await requireWorkspacePermission(tx, ctx, HelloWorldPermissions.READ);
  const parsed = z.string().uuid().safeParse(recordId);
  const row = parsed.success
    ? await tx.helloWorldRecord.findFirst({
        where: { id: parsed.data, workspaceId: ctx.workspaceId },
      })
    : null;
  if (!row) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Registro não encontrado.",
    });
  }
  return toDto(row, ctx);
}

/**
 * Creates a record under the demonstration limit. The advisory lock
 * serializes concurrent creations in the same workspace so the limit holds.
 */
export async function createHelloWorldRecord(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<HelloWorldRecordDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY);
  await requireWorkspacePermission(
    tx,
    ctx,
    HelloWorldPermissions.RECORDS_WRITE,
  );

  const parsed = CreateRecordInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Informe um título de 1 a 120 caracteres.",
    });
  }

  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`hello_world_records:${ctx.workspaceId}`}))`;
  const count = await tx.helloWorldRecord.count({
    where: { workspaceId: ctx.workspaceId },
  });
  if (count >= HELLO_WORLD_DEMO_RECORD_LIMIT) {
    throw new AppError({
      code: "conflict",
      safeMessage: `Limite de demonstração atingido (${HELLO_WORLD_DEMO_RECORD_LIMIT} registros por workspace).`,
    });
  }

  const row = await tx.helloWorldRecord.create({
    data: {
      workspaceId: ctx.workspaceId,
      organizationId: ctx.organizationId,
      title: parsed.data.title,
      createdBy: ctx.userId,
    },
  });

  await recordAudit(tx, ctx, {
    action: "hello_world.record.create",
    resourceType: "hello_world_record",
    resourceId: row.id,
    result: "success",
    metadata: { target: MODULE_KEY },
  });

  return toDto(row, ctx);
}

/**
 * Asks for a record to be created in the background (F3a reference job).
 * Checks now for immediate feedback; the job checks again when it runs.
 */
export async function enqueueHelloWorldRecord(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<{ jobRunId: string }> {
  await assertModuleOperational(tx, ctx, MODULE_KEY);
  await requireWorkspacePermission(
    tx,
    ctx,
    HelloWorldPermissions.RECORDS_WRITE,
  );
  const parsed = CreateRecordInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Informe um título de 1 a 120 caracteres.",
    });
  }
  const { createRecordJob } = await import("../../jobs");
  const { id } = await enqueueJob(tx, ctx, createRecordJob, parsed.data);
  return { jobRunId: id };
}
