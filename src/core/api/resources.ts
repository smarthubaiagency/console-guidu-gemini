import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { loadCompanyContract } from "@/core/entitlements/contract";
import { loadUsage } from "@/core/entitlements/usage";
import { loadWorkspaceModuleViews } from "@/core/module-runtime/loaders";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import { listUserWorkspaces } from "@/core/workspaces/navigation";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import type { ApiCall } from "./handler";

/**
 * Services of the core read routes of the REST API (F4a). They run in the
 * caller's context through withContext, so RLS and the same permission
 * checks of the web apply; the MCP of F4b reuses them.
 */

function ctxOf(call: ApiCall): RequestContext {
  if (!call.context) throw new Error("workspace route without context");
  return call.context;
}

// ---------------------------------------------------------------------------
// Cursor pagination (created_at desc, id desc)
// ---------------------------------------------------------------------------

// The cursor keeps the timestamp as Postgres prints it (microseconds);
// a JavaScript Date would cut it to milliseconds and skip rows.
const Cursor = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T][\d:.]+([+-]\d{2}(:?\d{2})?|Z)$/),
  id: z.string().uuid(),
});
type CursorValue = z.infer<typeof Cursor>;

export function encodeCursor(row: CursorValue): string {
  return Buffer.from(JSON.stringify({ t: row.t, id: row.id })).toString(
    "base64url",
  );
}

export function decodeCursor(value: string | undefined): CursorValue | null {
  if (!value) return null;
  try {
    const parsed = Cursor.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // falls through to the error below
  }
  throw new AppError({
    code: "invalid_input",
    safeMessage: "Cursor inválido.",
  });
}

function pageOf<T extends { cursor_t: string; cursor_id: string }>(
  rows: T[],
  limit: number,
) {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      more && last
        ? encodeCursor({ t: last.cursor_t, id: last.cursor_id })
        : null,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function listMyWorkspaces(prisma: PrismaClient, call: ApiCall) {
  const workspaces = await listUserWorkspaces(
    prisma,
    call.principal.userId,
    call.partnerId,
  );
  const principal = call.principal;
  const visible =
    principal.kind === "api_key"
      ? workspaces.filter((w) => w.workspaceId === principal.workspaceId)
      : workspaces;
  return {
    data: visible.map((w) => ({
      id: w.workspaceId,
      name: w.workspaceName,
      slug: w.workspaceSlug,
      role: w.workspaceRole,
      organization: { id: w.organizationId, name: w.organizationName },
    })),
  };
}

export async function getWorkspace(prisma: PrismaClient, call: ApiCall) {
  const ctx = ctxOf(call);
  return withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_READ);
    const w = await tx.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        organizationId: true,
        createdAt: true,
      },
    });
    return { data: { ...w, createdAt: w.createdAt.toISOString() } };
  });
}

export async function getWorkspaceOverview(
  prisma: PrismaClient,
  call: ApiCall,
) {
  const ctx = ctxOf(call);
  const views = await loadWorkspaceModuleViews(prisma, ctx, "");
  return withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_READ);
    const since = new Date(Date.now() - 86_400_000);
    const [members, runs, contract] = await Promise.all([
      tx.workspaceMember.count({
        where: { workspaceId: ctx.workspaceId, status: "active" },
      }),
      tx.jobRun.groupBy({
        by: ["status"],
        where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      loadCompanyContract(tx, ctx.organizationId),
    ]);
    const count = (statuses: string[]) =>
      runs
        .filter((r) => statuses.includes(r.status))
        .reduce((total, r) => total + r._count._all, 0);
    return {
      data: {
        workspaceId: ctx.workspaceId,
        members,
        enabledModules: views.modules.filter((m) => m.state === "enabled")
          .length,
        executionsLast24h: {
          succeeded: count(["succeeded"]),
          failed: count(["failed"]),
          waiting: count(["pending", "queued", "running"]),
        },
        contract:
          contract.kind === "subscribed"
            ? {
                kind: "subscribed",
                status: contract.status,
                planName: contract.planName,
              }
            : { kind: "legacy", status: null, planName: null },
      },
    };
  });
}

export async function listWorkspaceModules(
  prisma: PrismaClient,
  call: ApiCall,
) {
  const ctx = ctxOf(call);
  const views = await loadWorkspaceModuleViews(prisma, ctx, "");
  return {
    data: views.modules.map((m) => ({
      moduleKey: m.moduleKey,
      displayName: m.displayName,
      releaseStatus: m.releaseStatus,
      state: m.state,
      stateLabel: m.stateLabel,
    })),
  };
}

export async function getWorkspaceUsage(prisma: PrismaClient, call: ApiCall) {
  const ctx = ctxOf(call);
  return withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_READ);
    const usage = await loadUsage(tx, ctx);
    return { data: usage.rows };
  });
}

export async function listWorkspaceExecutions(
  prisma: PrismaClient,
  call: ApiCall,
) {
  const ctx = ctxOf(call);
  const limit = Number(call.query.limit ?? 25);
  const cursor = decodeCursor(call.query.cursor as string | undefined);
  return withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_READ);
    const rows = await tx.$queryRaw<
      {
        id: string;
        kind: string;
        status: string;
        attempts: number;
        max_attempts: number;
        last_error: string | null;
        created_at: Date;
        started_at: Date | null;
        finished_at: Date | null;
        cursor_t: string;
        cursor_id: string;
      }[]
    >`
      select id, kind, status, attempts, max_attempts, last_error, created_at,
             started_at, finished_at, created_at::text as cursor_t, id::text as cursor_id
      from public.job_runs
      where workspace_id = ${ctx.workspaceId}::uuid
        and (${cursor === null}::boolean
             or (created_at, id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      order by created_at desc, id desc
      limit ${limit + 1}
    `;
    const { items, nextCursor } = pageOf(rows, limit);
    return {
      data: items.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
        lastError: r.last_error,
        createdAt: r.created_at.toISOString(),
        startedAt: iso(r.started_at),
        finishedAt: iso(r.finished_at),
      })),
      nextCursor,
    };
  });
}

export async function listWorkspaceMembers(
  prisma: PrismaClient,
  call: ApiCall,
) {
  const ctx = ctxOf(call);
  const limit = Number(call.query.limit ?? 25);
  const cursor = decodeCursor(call.query.cursor as string | undefined);
  return withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(
      tx,
      ctx,
      Permissions.WORKSPACE_MEMBERS_READ,
    );
    // Members have no id of their own; the user id breaks ties.
    const rows = await tx.$queryRaw<
      {
        user_id: string;
        role: string;
        status: string;
        created_at: Date;
        cursor_t: string;
        cursor_id: string;
      }[]
    >`
      select user_id, role, status, created_at,
             created_at::text as cursor_t, user_id::text as cursor_id
      from public.workspace_members
      where workspace_id = ${ctx.workspaceId}::uuid
        and (${cursor === null}::boolean
             or (created_at, user_id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      order by created_at desc, user_id desc
      limit ${limit + 1}
    `;
    const { items, nextCursor } = pageOf(rows, limit);
    return {
      data: items.map((r) => ({
        userId: r.user_id,
        role: r.role,
        status: r.status,
        joinedAt: r.created_at.toISOString(),
      })),
      nextCursor,
    };
  });
}
