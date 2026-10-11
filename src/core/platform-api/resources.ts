import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { getOperationsOverview } from "@/core/operations/service";
import { type Permission, Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { hasPlatformRolePermission } from "@/core/permissions/matrix";
import { AppError } from "@/shared/errors";

import { type PlatformActor, withPlatformContext } from "./context";

/**
 * Read services of the platform API and MCP (F4e). Customers carry minimal
 * commercial data; operations carry health and failures, never customer
 * content. The database repeats the checks: the organization lists come
 * from definer functions that require an active internal role, and the
 * subscriptions and job tables have their own role policies.
 */

const isoDate = z.string().datetime();

export const PlatformCustomer = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  maxSeats: z.number().int(),
  workspaces: z.number().int(),
  createdAt: isoDate,
  /** Present only for roles that read billing (owner, operations, billing). */
  plan: z.object({ name: z.string(), status: z.string() }).nullable(),
});
export type PlatformCustomerType = z.infer<typeof PlatformCustomer>;

export const PlatformHealth = z.object({
  generatedAt: isoDate,
  workers: z.array(
    z.object({
      instanceName: z.string(),
      state: z.enum(["online", "stopped", "silent"]),
      lastSeenAt: isoDate,
      version: z.string().nullable(),
    }),
  ),
  metrics: z.object({
    capturedAt: isoDate.nullable(),
    stale: z.boolean(),
    totals: z.object({
      waiting: z.number().int(),
      running: z.number().int(),
      succeeded24h: z.number().int(),
      failed24h: z.number().int(),
      skipped24h: z.number().int(),
    }),
    queues: z.array(
      z.object({
        kind: z.string(),
        waiting: z.number().int(),
        running: z.number().int(),
        failed24h: z.number().int(),
        oldestPendingSeconds: z.number().int().nullable(),
      }),
    ),
  }),
});

export const FailedJob = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  scope: z.string(),
  workspaceId: z.string().uuid().nullable(),
  attempts: z.number().int(),
  /** Safe message recorded by the worker; never a payload. */
  error: z.string().nullable(),
  finishedAt: isoDate.nullable(),
});

export const CustomerListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z
    .string()
    .regex(/^\d{1,6}$/)
    .optional(),
});

export const FailedJobsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  days: z.coerce.number().int().min(1).max(30).default(7),
});

function requirePermission(actor: PlatformActor, permission: Permission): void {
  if (!hasPlatformRolePermission(actor.role, permission)) {
    throw new PermissionDeniedError();
  }
}

type OrgRow = {
  id: string;
  name: string;
  status: string;
  max_seats: number;
  created_at: Date;
};

async function loadCustomers(
  prisma: PrismaClient,
  actor: PlatformActor,
): Promise<PlatformCustomerType[]> {
  requirePermission(actor, Permissions.PLATFORM_CUSTOMERS_READ);
  const readsBilling = hasPlatformRolePermission(
    actor.role,
    Permissions.PLATFORM_BILLING_READ,
  );
  return withPlatformContext(prisma, actor, async (tx) => {
    const [orgs, workspaces, plans] = await Promise.all([
      tx.$queryRaw<OrgRow[]>`
        select id, name, status, max_seats, created_at
        from private.list_admin_organizations()
      `,
      tx.$queryRaw<{ organization_id: string }[]>`
        select organization_id from private.list_admin_workspaces()
      `,
      readsBilling
        ? tx.subscription.findMany({
            where: { status: { not: "canceled" } },
            select: {
              organizationId: true,
              status: true,
              planVersion: { select: { plan: { select: { name: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);
    const counts = new Map<string, number>();
    for (const w of workspaces) {
      counts.set(w.organization_id, (counts.get(w.organization_id) ?? 0) + 1);
    }
    const planByOrg = new Map(plans.map((p) => [p.organizationId, p]));
    return orgs.map((o) => {
      const plan = planByOrg.get(o.id);
      return {
        id: o.id,
        name: o.name,
        status: o.status,
        maxSeats: o.max_seats,
        workspaces: counts.get(o.id) ?? 0,
        createdAt: new Date(o.created_at).toISOString(),
        plan: plan
          ? { name: plan.planVersion.plan.name, status: plan.status }
          : null,
      };
    });
  });
}

/** Customer companies, newest first; the cursor is an offset. */
export async function listCustomers(
  prisma: PrismaClient,
  actor: PlatformActor,
  query: z.input<typeof CustomerListQuery> = {},
): Promise<{ data: PlatformCustomerType[]; nextCursor: string | null }> {
  const q = CustomerListQuery.parse(query);
  const all = await loadCustomers(prisma, actor);
  const start = q.cursor ? Number(q.cursor) : 0;
  const data = all.slice(start, start + q.limit);
  const next = start + q.limit;
  return { data, nextCursor: next < all.length ? String(next) : null };
}

export async function getCustomer(
  prisma: PrismaClient,
  actor: PlatformActor,
  customerId: string,
): Promise<{ data: PlatformCustomerType }> {
  const id = z.string().uuid().safeParse(customerId);
  const found = id.success
    ? (await loadCustomers(prisma, actor)).find(
        (c) => c.id === id.data.toLowerCase(),
      )
    : undefined;
  if (!found) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Empresa não encontrada.",
    });
  }
  return { data: found };
}

export async function getPlatformHealth(
  prisma: PrismaClient,
  actor: PlatformActor,
): Promise<{ data: z.infer<typeof PlatformHealth> }> {
  requirePermission(actor, Permissions.PLATFORM_OPERATIONS_READ);
  const overview = await withPlatformContext(prisma, actor, (tx) =>
    getOperationsOverview(tx, {
      userId: actor.userId,
      platformRole: actor.role,
    }),
  );
  return {
    data: {
      generatedAt: overview.generatedAt.toISOString(),
      workers: overview.workers.map((w) => ({
        instanceName: w.instanceName,
        state: w.state,
        lastSeenAt: w.lastSeenAt.toISOString(),
        version: w.version,
      })),
      metrics: {
        capturedAt: overview.metrics.capturedAt?.toISOString() ?? null,
        stale: overview.metrics.stale,
        totals: {
          waiting: overview.metrics.totals.waiting,
          running: overview.metrics.totals.running,
          succeeded24h: overview.metrics.totals.succeeded24h,
          failed24h: overview.metrics.totals.failed24h,
          skipped24h: overview.metrics.totals.skipped24h,
        },
        queues: overview.metrics.queues.map((q) => ({
          kind: q.kind,
          waiting: q.pending + q.queued,
          running: q.running,
          failed24h: q.failed24h,
          oldestPendingSeconds: q.oldestPendingSeconds,
        })),
      },
    },
  };
}

export async function listFailedJobs(
  prisma: PrismaClient,
  actor: PlatformActor,
  query: z.input<typeof FailedJobsQuery> = {},
): Promise<{ data: z.infer<typeof FailedJob>[] }> {
  requirePermission(actor, Permissions.PLATFORM_OPERATIONS_READ);
  const q = FailedJobsQuery.parse(query);
  const rows = await withPlatformContext(prisma, actor, (tx) =>
    tx.jobRun.findMany({
      where: {
        status: "failed",
        finishedAt: { gte: new Date(Date.now() - q.days * 86_400_000) },
      },
      orderBy: { finishedAt: "desc" },
      take: q.limit,
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
  );
  return {
    data: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      scope: r.scope,
      workspaceId: r.workspaceId,
      attempts: r.attempts,
      error: r.lastError,
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  };
}
