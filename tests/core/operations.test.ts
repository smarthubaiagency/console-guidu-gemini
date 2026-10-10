import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { JobDefinition } from "@/core/jobs/definition";
import { checkReadiness } from "@/core/operations/health";
import { getOperationsOverview } from "@/core/operations/service";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { createRecordJob } from "@/modules/hello-world/jobs";
import { createJobWorker } from "@/worker/runtime";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

/** Platform owner of admin-seed.sql. */
const platformOwner = "d0000000-0000-4000-8000-000000000003";
const kind = createRecordJob.kind;

describeDatabase("F3d: operations overview", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const worker = createJobWorker({
    databaseUrl: workerUrl ?? "",
    definitions: [
      createRecordJob,
    ] as unknown as readonly JobDefinition<unknown>[],
    instanceName: "f3d-test",
    concurrency: 2,
    log: () => {},
  });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where idempotency_key like 'f3d-%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.queue_metrics where instance_name = 'f3d-test'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.worker_heartbeats where instance_name = 'f3d-test'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    const base = `'${kind}', 'workspace', '${ids.organizationA}', '${ids.workspaceA}', '${ids.userA}'`;
    await admin.$executeRawUnsafe(
      `insert into public.job_runs
         (kind, scope, organization_id, workspace_id, requested_by, idempotency_key, status,
          created_at, started_at, finished_at, attempts, last_error)
       values
         (${base}, 'f3d-pending', 'pending', now() - interval '10 minutes', null, null, 0, null),
         (${base}, 'f3d-ok', 'succeeded', now() - interval '1 hour',
          now() - interval '1 hour', now() - interval '1 hour' + interval '500 milliseconds', 1, null),
         (${base}, 'f3d-failed', 'failed', now() - interval '40 minutes',
          now() - interval '35 minutes', now() - interval '30 minutes', 3, 'Falha simulada F3d.')`,
    );
  });

  afterAll(async () => {
    await worker.stop().catch(() => undefined);
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("answers readiness against the real database", async () => {
    expect(await checkReadiness(prisma)).toMatchObject({
      ready: true,
      checks: { database: "ok" },
    });
  });

  it("shows the worker's heartbeat, queue snapshot and failures to the platform", async () => {
    await worker.heartbeatOnce();
    expect(await worker.publishMetricsOnce()).toBe(1);

    const overview = await withIdentityContext(
      prisma,
      platformOwner,
      (tx) =>
        getOperationsOverview(tx, {
          userId: platformOwner,
          platformRole: "owner",
        }),
      { partnerId: HOUSE_PARTNER_ID },
    );
    expect(
      overview.workers.find((w) => w.instanceName === "f3d-test"),
    ).toMatchObject({
      state: "online",
      concurrency: 2,
      queues: 1,
    });
    const queue = overview.metrics.queues.find((q) => q.kind === kind);
    expect(queue).toMatchObject({
      pending: 1,
      succeeded24h: 1,
      failed24h: 1,
      sample24h: 1,
      bossWaiting: 0,
    });
    expect(queue?.oldestPendingSeconds).toBeGreaterThanOrEqual(590);
    expect(queue?.avgDurationMs24h).toBe(500);
    expect(overview.metrics.stale).toBe(false);
    expect(
      overview.failures.find((f) => f.lastError === "Falha simulada F3d."),
    ).toMatchObject({ kind, scope: "workspace", attempts: 3 });
  });

  it("marks a stopped worker and keeps operations from other roles", async () => {
    await worker.start();
    expect(worker.health()).toMatchObject({ live: true, ready: true });
    await worker.stop();
    expect(worker.health().ready).toBe(false);
    const row = await admin.workerHeartbeat.findUniqueOrThrow({
      where: { instanceName: "f3d-test" },
    });
    expect(row.status).toBe("stopped");

    await expect(
      withIdentityContext(
        prisma,
        platformOwner,
        (tx) =>
          getOperationsOverview(tx, {
            userId: platformOwner,
            platformRole: "billing",
          }),
        { partnerId: HOUSE_PARTNER_ID },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // A customer reaching the tables directly sees nothing (RLS).
    const seen = await withIdentityContext(prisma, ids.userA, (tx) =>
      Promise.all([tx.workerHeartbeat.count(), tx.queueMetric.count()]),
    );
    expect(seen).toEqual([0, 0]);
  });
});
