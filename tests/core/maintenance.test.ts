import { PrismaClient } from "@prisma/client";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { API_ROUTES } from "@/core/api/contracts";
import { type ApiDeps, handleApiRoute } from "@/core/api/handler";
import { AccessDeniedError } from "@/core/auth/errors";
import {
  defineJob,
  type JobDefinition,
  queueName,
} from "@/core/jobs/definition";
import { enqueueJob } from "@/core/jobs/service";
import { queryMaintenanceWindow } from "@/core/maintenance/read";
import {
  evaluateMaintenance,
  type MaintenanceStatus,
} from "@/core/maintenance/state";
import { handleMcpWorkspaceRequest } from "@/core/mcp/server";
import {
  endMaintenance,
  type MaintenanceActor,
  type MaintenanceInput,
  maintenanceView,
  saveMaintenance,
} from "@/core/maintenance/service";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";
import { createJobWorker, type JobWorker } from "@/worker/runtime";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF5c: Operações › Manutenção. Owner and operations save the window, every
 * change is audited, support only reads it, the state is read without
 * context by the web and the worker, and the worker holds the jobs while a
 * window is in force: nothing runs and nothing is lost.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const OWNER = "d0000000-0000-4000-8000-000000000003";
const SUPPORT = "d0000000-0000-4000-8000-000000000005";
const owner: MaintenanceActor = { userId: OWNER, platformRole: "owner" };
const support: MaintenanceActor = { userId: SUPPORT, platformRole: "support" };

let ran = 0;
const probeJob = defineJob({
  kind: "test.maintenance-probe",
  description: "Teste: conta as execuções durante a manutenção.",
  payload: z.object({}),
  async run() {
    ran += 1;
    return { ran };
  },
});
const definitions = [probeJob] as unknown as readonly JobDefinition<unknown>[];

const input = (over: Partial<MaintenanceInput> = {}): MaintenanceInput => ({
  enabled: true,
  mode: "maintenance",
  startsAt: null,
  endsAt: null,
  messages: {},
  ...over,
});

describeDatabase("CF5c: maintenance window", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });
  const workers: JobWorker[] = [];
  const startedAt = new Date();

  const asOwner = <T>(
    op: Parameters<typeof withIdentityContext<T>>[2],
  ): Promise<T> => withIdentityContext(prisma, OWNER, op);

  async function cleanup() {
    await admin.$executeRawUnsafe(`delete from public.platform_maintenance`);
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where kind = '${probeJob.kind}'`,
    );
  }

  async function startWorker(): Promise<JobWorker> {
    const worker = createJobWorker({
      databaseUrl: workerUrl ?? "",
      definitions,
      schedules: [],
      concurrency: 2,
      dispatchIntervalMs: 200,
      pollingIntervalSeconds: 0.5,
      maintenanceCacheMs: 0,
      instanceName: "cf5c-maintenance",
      log: () => {},
    });
    workers.push(worker);
    await worker.start();
    return worker;
  }

  async function waitFor<T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
    timeoutMs = 20_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (done(value)) return value;
      if (Date.now() > deadline) {
        throw new Error(`timeout waiting: ${JSON.stringify(value)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const status = (id: string) =>
    admin.jobRun.findUniqueOrThrow({ where: { id } }).then((run) => run.status);

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.platform_admin_members (user_id, role, status)
       values ('${SUPPORT}', 'support', 'active')
       on conflict (user_id) do update set role = 'support', status = 'active'`,
    );
  });

  afterEach(async () => {
    while (workers.length) await workers.pop()!.stop();
  });

  afterAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.platform_admin_members where user_id = '${SUPPORT}'`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("saves, audits and reads the window; support only reads", async () => {
    const now = new Date();
    const endsAt = new Date(now.getTime() + 60 * 60_000);
    const view = await asOwner((tx) =>
      saveMaintenance(
        tx,
        owner,
        input({
          mode: "read_only",
          endsAt,
          messages: {
            "pt-BR": "  Volta às 23h.  ",
            en: "",
            es: "Vuelve pronto.",
          },
        }),
        now,
      ),
    );
    expect(view.status).toMatchObject({
      phase: "active",
      window: { mode: "read_only" },
    });
    expect(view.record).toMatchObject({
      enabled: true,
      mode: "read_only",
      endsAt,
      messages: { "pt-BR": "Volta às 23h.", es: "Vuelve pronto." },
    });
    // An empty start is stored as the moment of the save.
    expect(view.record?.startsAt?.getTime()).toBe(now.getTime());

    // Nothing changed, nothing audited.
    await asOwner((tx) =>
      saveMaintenance(
        tx,
        owner,
        input({
          mode: "read_only",
          startsAt: now,
          endsAt,
          messages: { "pt-BR": "Volta às 23h.", es: "Vuelve pronto." },
        }),
        now,
      ),
    );
    const audits = await admin.auditEvent.findMany({
      where: {
        action: "platform.maintenance.save",
        occurredAt: { gte: startedAt },
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: OWNER, result: "success" });
    expect(audits[0]?.metadata).toMatchObject({
      status: "on",
      mode: "read_only",
      endsAt: endsAt.toISOString(),
    });
    expect(JSON.stringify(audits[0]?.metadata)).not.toContain("Volta");

    // Support reads the window but cannot change it.
    const supportView = await withIdentityContext(prisma, SUPPORT, (tx) =>
      maintenanceView(tx, support),
    );
    expect(supportView).toMatchObject({
      canEdit: false,
      record: { mode: "read_only" },
    });
    await expect(
      withIdentityContext(prisma, SUPPORT, (tx) =>
        saveMaintenance(tx, support, input()),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    // A user without a platform role sees nothing.
    const plain = await withIdentityContext(prisma, ids.userA, (tx) =>
      maintenanceView(tx, { userId: ids.userA, platformRole: null }),
    );
    expect(plain.record).toBeNull();

    // Web and worker read the state without any context.
    for (const client of [prisma, workerDb]) {
      expect(await queryMaintenanceWindow(client)).toMatchObject({
        mode: "read_only",
        messages: { "pt-BR": "Volta às 23h.", es: "Vuelve pronto." },
      });
    }

    // Ending it is audited, and the state goes away.
    await asOwner((tx) => endMaintenance(tx, owner));
    expect(await queryMaintenanceWindow(prisma)).toBeNull();
    expect(
      await admin.auditEvent.count({
        where: {
          action: "platform.maintenance.end",
          occurredAt: { gte: startedAt },
        },
      }),
    ).toBe(1);
  });

  it("refuses a bad mode, an end before the start or in the past, and long messages", async () => {
    const now = new Date();
    const cases: Array<[Partial<MaintenanceInput>, string]> = [
      [{ mode: "closed" }, "maintenance.errors.invalidMode"],
      [
        {
          startsAt: new Date(now.getTime() + 60_000),
          endsAt: new Date(now.getTime() + 30_000),
        },
        "maintenance.errors.endBeforeStart",
      ],
      [
        {
          startsAt: new Date(now.getTime() - 120_000),
          endsAt: new Date(now.getTime() - 60_000),
        },
        "maintenance.errors.endInPast",
      ],
      [
        { messages: { en: "x".repeat(501) } },
        "maintenance.errors.messageTooLong",
      ],
    ];
    for (const [over, key] of cases) {
      const error = await asOwner((tx) =>
        saveMaintenance(tx, owner, input(over), now),
      ).catch((err: unknown) => err);
      expect(error, key).toBeInstanceOf(AppError);
      expect((error as AppError).messageKey).toBe(key);
    }
    // A scheduled window is not in force yet.
    const scheduled = await asOwner((tx) =>
      saveMaintenance(
        tx,
        owner,
        input({ startsAt: new Date(now.getTime() + 3 * 60 * 60_000) }),
        now,
      ),
    );
    expect(scheduled.status).toMatchObject({
      phase: "scheduled",
      notice: true,
    });
    await asOwner((tx) => endMaintenance(tx, owner));
  });

  it("answers 503 with Retry-After on the public API and the workspace MCP", async () => {
    let current: MaintenanceStatus = { phase: "off" };
    const deps: ApiDeps = {
      prisma,
      redis: null,
      session: async () => {
        throw new AccessDeniedError("unauthenticated", 401);
      },
      maintenance: async () => current,
    };
    const call = (route: keyof typeof API_ROUTES) =>
      handleApiRoute(
        new Request("http://localhost:3000/api/v1/x", {
          method: API_ROUTES[route].method,
          headers: {
            host: "localhost:3000",
            "content-type": "application/json",
          },
          ...(API_ROUTES[route].method === "GET" ? {} : { body: "{}" }),
        }),
        API_ROUTES[route],
        { id: ids.workspaceA },
        deps,
        async () => ({}),
      );
    const windowOf = (mode: "maintenance" | "read_only") =>
      evaluateMaintenance(
        {
          mode,
          startsAt: null,
          endsAt: new Date(Date.now() + 15 * 60_000),
          messages: {},
        },
        new Date(),
      );

    // No window: the call reaches the authentication (401 here).
    expect((await call("listMyWorkspaces")).status).toBe(401);

    current = windowOf("maintenance");
    const closed = await call("listMyWorkspaces");
    expect(closed.status).toBe(503);
    expect(Number(closed.headers.get("retry-after"))).toBeGreaterThan(800);
    expect(
      ((await closed.json()) as { error: { code: string } }).error.code,
    ).toBe("maintenance");
    const mcp = await handleMcpWorkspaceRequest(
      new Request("http://localhost:3000/mcp/workspace", {
        method: "POST",
        headers: { host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      deps,
    );
    expect(mcp.status).toBe(503);
    expect(mcp.headers.get("retry-after")).not.toBeNull();

    // Read-only: reads (and read-only searches) pass, writes are refused.
    current = windowOf("read_only");
    expect((await call("listMyWorkspaces")).status).toBe(401);
    expect((await call("searchPortfolioCatalog")).status).toBe(401);
    for (const route of ["createCrmContact", "updatePortfolioItem"] as const) {
      const refused = await call(route);
      expect(refused.status, route).toBe(503);
      expect(
        ((await refused.json()) as { error: { code: string } }).error.code,
      ).toBe("read_only");
    }
  });

  it("holds the jobs during the window and runs them after, nothing lost", async () => {
    ran = 0;
    await asOwner((tx) => saveMaintenance(tx, owner, input()));
    const { id } = await withContext(prisma, contextA, (tx) =>
      enqueueJob(tx, contextA, probeJob, {}),
    );
    const worker = await startWorker();
    expect(await worker.dispatchOnce()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await status(id)).toBe("pending");
    expect(ran).toBe(0);

    // A run sent to the queue before the window began goes back to pending.
    const queued = await withContext(prisma, contextA, (tx) =>
      enqueueJob(tx, contextA, probeJob, {}),
    );
    await admin.$executeRawUnsafe(
      `update public.job_runs set status = 'queued', dispatched_at = now() where id = '${queued.id}'`,
    );
    const boss = new PgBoss({
      connectionString: workerUrl ?? "",
      schema: "pgboss",
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.send(queueName(probeJob.kind), { jobRunId: queued.id });
    await boss.stop({ graceful: false });
    await waitFor(
      () => status(queued.id),
      (value) => value === "pending",
    );
    expect(ran).toBe(0);

    // The window ends: both run.
    await asOwner((tx) => endMaintenance(tx, owner));
    await waitFor(
      () => Promise.all([status(id), status(queued.id)]),
      (values) => values.every((value) => value === "succeeded"),
    );
    expect(ran).toBe(2);
  });
});
