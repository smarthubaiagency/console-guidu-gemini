import { createHash } from "node:crypto";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { defineJob } from "@/core/jobs/definition";
import { enqueueJob } from "@/core/jobs/service";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import type { ExportedRows } from "./contract";
import { listModuleDataContracts } from "./registry";

/**
 * Workspace export (F3e, AC12): owner and admin ask with MFA verified; a
 * job builds one JSON file in the requester's context (RLS decides what it
 * sees, as in the web), stores it in `workspace_exports` and it is offered
 * for 24 hours through a short link. Secrets never enter the file: API key
 * hashes, credential payloads and invitation tokens are left out.
 */

export const EXPORT_FORMAT = "guidu.workspace-export";
export const EXPORT_VERSION = 1;
export const EXPORT_MAX_BYTES = 25 * 1024 * 1024;
export const EXPORT_AVAILABLE_MS = 24 * 60 * 60_000;

export type ExportStatus =
  "pending" | "running" | "ready" | "failed" | "expired";

export type WorkspaceExportView = Readonly<{
  id: string;
  status: ExportStatus;
  fileSize: number | null;
  error: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  requestedByMe: boolean;
}>;

export type Assurance = Readonly<{ mfaVerified: boolean }>;

export function requireMfa(assurance: Assurance): void {
  if (!assurance.mfaVerified) {
    throw new AppError({
      code: "forbidden",
      safeMessage: "Confirme a verificação em duas etapas para continuar.",
    });
  }
}

export async function requestWorkspaceExport(
  tx: ContextTransaction,
  ctx: RequestContext,
  assurance: Assurance,
): Promise<{ exportId: string }> {
  await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_DATA_EXPORT);
  requireMfa(assurance);
  const open = await tx.workspaceExport.count({
    where: {
      workspaceId: ctx.workspaceId,
      status: { in: ["pending", "running"] },
    },
  });
  if (open > 0) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Já existe uma exportação em andamento neste workspace.",
    });
  }
  const created = await tx.workspaceExport.create({
    data: {
      workspaceId: ctx.workspaceId,
      organizationId: ctx.organizationId,
      requestedBy: ctx.userId,
    },
    select: { id: true },
  });
  await enqueueJob(
    tx,
    ctx,
    workspaceExportJob,
    { exportId: created.id },
    { idempotencyKey: `export:${created.id}` },
  );
  await recordAudit(tx, ctx, {
    action: "workspace.export.request",
    resourceType: "workspace_export",
    resourceId: created.id,
    result: "success",
  });
  return { exportId: created.id };
}

export async function listWorkspaceExports(
  tx: ContextTransaction,
  ctx: RequestContext,
  take = 10,
): Promise<WorkspaceExportView[]> {
  await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_DATA_EXPORT);
  const rows = await tx.workspaceExport.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      status: true,
      fileSize: true,
      error: true,
      createdAt: true,
      expiresAt: true,
      requestedBy: true,
    },
  });
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    status:
      row.status === "ready" && row.expiresAt && row.expiresAt.getTime() <= now
        ? "expired"
        : (row.status as ExportStatus),
    fileSize: row.fileSize,
    error: row.error,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    requestedByMe: row.requestedBy === ctx.userId,
  }));
}

/** The file of a ready, unexpired export of the context workspace. */
export async function loadExportFile(
  tx: ContextTransaction,
  ctx: RequestContext,
  exportId: string,
  assurance: Assurance,
): Promise<{ file: Buffer; fileName: string; sha256: string }> {
  await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_DATA_EXPORT);
  requireMfa(assurance);
  const row = await tx.workspaceExport.findFirst({
    where: {
      id: exportId,
      workspaceId: ctx.workspaceId,
      status: "ready",
      expiresAt: { gt: new Date() },
    },
    select: { file: true, sha256: true, createdAt: true },
  });
  if (!row?.file || !row.sha256) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Exportação não encontrada ou expirada.",
    });
  }
  await recordAudit(tx, ctx, {
    action: "workspace.export.download",
    resourceType: "workspace_export",
    resourceId: exportId,
    result: "success",
  });
  const date = row.createdAt.toISOString().slice(0, 10);
  return {
    file: Buffer.from(row.file),
    fileName: `workspace-${date}-${exportId.slice(0, 8)}.json`,
    sha256: row.sha256,
  };
}

// ---------------------------------------------------------------------------
// Building the file (in the export job)
// ---------------------------------------------------------------------------

/** Everything the requester may see in the workspace, as plain JSON. */
export async function buildWorkspaceExport(
  tx: ContextTransaction,
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const where = { workspaceId: ctx.workspaceId };
  const [workspace, members, invitations, apiKeys, credentials, modules, jobs] =
    await Promise.all([
      tx.workspace.findUniqueOrThrow({
        where: { id: ctx.workspaceId },
        select: { id: true, name: true, slug: true, createdAt: true },
      }),
      tx.workspaceMember.findMany({
        where,
        orderBy: { createdAt: "asc" },
        select: { userId: true, role: true, status: true, createdAt: true },
      }),
      tx.invitation.findMany({
        where,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          expiresAt: true,
          acceptedAt: true,
        },
      }),
      tx.apiKey.findMany({
        where,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          status: true,
          userId: true,
          createdAt: true,
          expiresAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      }),
      tx.credential.findMany({
        where,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          provider: true,
          purpose: true,
          label: true,
          maskedValue: true,
          status: true,
          createdAt: true,
        },
      }),
      tx.workspaceModule.findMany({
        where,
        orderBy: { moduleKey: "asc" },
        select: {
          moduleKey: true,
          status: true,
          config: true,
          updatedAt: true,
        },
      }),
      tx.jobRun.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: 5000,
        select: {
          id: true,
          kind: true,
          status: true,
          attempts: true,
          createdAt: true,
          finishedAt: true,
        },
      }),
    ]);

  const moduleData: Record<string, Record<string, ExportedRows>> = {};
  for (const contract of listModuleDataContracts()) {
    moduleData[contract.moduleKey] = { ...(await contract.export(tx, ctx)) };
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    generatedAt: now.toISOString(),
    workspace,
    core: {
      members,
      invitations,
      apiKeys,
      credentials,
      modules,
      jobRuns: jobs,
    },
    modules: moduleData,
    notes: [
      "Chaves de API, credenciais e convites aparecem sem segredos (hash, conteúdo cifrado e token ficam fora).",
      "A auditoria do workspace não entra nesta exportação; é pedida ao suporte.",
    ],
  };
}

export function serializeExport(data: unknown): Buffer {
  return Buffer.from(
    JSON.stringify(
      data,
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      2,
    ),
    "utf8",
  );
}

export const workspaceExportJob = defineJob({
  kind: "core.workspace-export",
  description: "Gera a exportação dos dados do workspace.",
  payload: z.object({ exportId: z.string().uuid() }),
  maxAttempts: 3,
  retryDelaySeconds: 30,
  expireInSeconds: 600,
  async run(tx, ctx, payload) {
    // The requester must still be allowed when the job runs.
    await requireWorkspacePermission(
      tx,
      ctx,
      Permissions.WORKSPACE_DATA_EXPORT,
    );
    const started = await tx.workspaceExport.updateMany({
      where: {
        id: payload.exportId,
        workspaceId: ctx.workspaceId,
        status: { in: ["pending", "running"] },
      },
      data: { status: "running" },
    });
    if (started.count === 0)
      return { exportId: payload.exportId, skipped: true };

    const now = new Date();
    const file = serializeExport(await buildWorkspaceExport(tx, ctx, now));
    if (file.length > EXPORT_MAX_BYTES) {
      await tx.workspaceExport.update({
        where: { id: payload.exportId },
        data: {
          status: "failed",
          error: "A exportação passou de 25 MB; fale com o suporte.",
          finishedAt: now,
        },
        select: { id: true },
      });
      return { exportId: payload.exportId, bytes: file.length, failed: true };
    }
    await tx.workspaceExport.update({
      where: { id: payload.exportId },
      data: {
        status: "ready",
        file,
        fileSize: file.length,
        sha256: createHash("sha256").update(file).digest("hex"),
        expiresAt: new Date(now.getTime() + EXPORT_AVAILABLE_MS),
        finishedAt: now,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: "workspace.export.ready",
      resourceType: "workspace_export",
      resourceId: payload.exportId,
      result: "success",
      origin: "worker",
    });
    return { exportId: payload.exportId, bytes: file.length };
  },
});
