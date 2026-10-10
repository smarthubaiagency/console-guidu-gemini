import { PrismaClient } from "@prisma/client";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import {
  DEAD_LETTER_QUEUE,
  defineJob,
  type JobDefinition,
  queueName,
} from "@/core/jobs/definition";
import { enqueueJob, retryJobRun } from "@/core/jobs/service";
import { withContext } from "@/lib/prisma/with-context";
import { enqueueHelloWorldRecord } from "@/modules/hello-world/server/services/records";
import { createRecordJob } from "@/modules/hello-world/jobs";
import { createJobWorker, type JobWorker } from "@/worker/runtime";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

/** Fixture user (membership-seed.sql) given a temporary editor role in A. */
const editor = "d0000000-0000-4000-8000-000000000008";
const editorCtx = { ...contextA, userId: editor };

// Test-only jobs: they never reach the registry of the build.
let inFlight = new Map<string, number>();
let maxInFlight = new Map<string, number>();
let maxOverall = 0;
const slowJob = defineJob({
  kind: "test.slow",
  description: "Teste: ocupa o worker por um tempo.",
  payload: z.object({ ms: z.number().int().min(0).max(2000) }),
  async run(_tx, ctx, payload) {
    const now = (inFlight.get(ctx.workspaceId) ?? 0) + 1;
    inFlight.set(ctx.workspaceId, now);
    maxInFlight.set(
      ctx.workspaceId,
      Math.max(maxInFlight.get(ctx.workspaceId) ?? 0, now),
    );
    maxOverall = Math.max(
      maxOverall,
      [...inFlight.values()].reduce((a, b) => a + b, 0),
    );
    await new Promise((resolve) => setTimeout(resolve, payload.ms));
    inFlight.set(ctx.workspaceId, (inFlight.get(ctx.workspaceId) ?? 1) - 1);
    return { slept: payload.ms };
  },
});
const failingJob = defineJob({
  kind: "test.always-fails",
  description: "Teste: falha sempre.",
  payload: z.object({}),
  maxAttempts: 2,
  retryDelaySeconds: 1,
  async run() {
    throw new Error("falha simulada");
  },
});
const definitions = [
  createRecordJob,
  slowJob,
  failingJob,
] as unknown as readonly JobDefinition<unknown>[];

describeDatabase("F3a: jobs and worker (ADR 0002)", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workers: JobWorker[] = [];

  function startWorker(name: string): Promise<JobWorker> {
    const worker = createJobWorker({
      databaseUrl: workerUrl ?? "",
      definitions,
      concurrency: 4,
      dispatchIntervalMs: 200,
      pollingIntervalSeconds: 0.5,
      instanceName: name,
      log: () => {},
    });
    workers.push(worker);
    return worker.start().then(() => worker);
  }

  async function stopWorkers() {
    while (workers.length) await workers.pop()!.stop();
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
      if (Date.now() > deadline)
        throw new Error(`timeout waiting: ${JSON.stringify(value)}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const run = (id: string) => admin.jobRun.findUniqueOrThrow({ where: { id } });
  const finished = (r: { status: string }) =>
    ["succeeded", "failed", "skipped"].includes(r.status);

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.hello_world_records where title like 'F3a %'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.workspace_members where user_id = '${editor}' and workspace_id = '${ids.workspaceA}'`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "true");
    await cleanup();
    for (const [org, ws, user] of [
      [ids.organizationA, ids.workspaceA, ids.userA],
      [ids.organizationB, ids.workspaceB, ids.userB],
    ]) {
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
         values ('${org}', '${ws}', 'hello-world', 'enabled', '${user}')
         on conflict (workspace_id, module_key) do update set status = 'enabled'`,
      );
    }
    await admin.$executeRawUnsafe(
      `insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
       values ('${ids.workspaceA}', '${ids.organizationA}', '${editor}', 'editor', 'active')`,
    );
  });

  afterEach(async () => {
    await stopWorkers();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where module_key = 'hello-world' and workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("enqueues only when the action commits (outbox)", async () => {
    await expect(
      withContext(prisma, contextA, async (tx) => {
        await enqueueHelloWorldRecord(tx, contextA, { title: "F3a rollback" });
        throw new Error("action failed");
      }),
    ).rejects.toThrow("action failed");
    expect(
      await admin.jobRun.count({ where: { workspaceId: ids.workspaceA } }),
    ).toBe(0);
  });

  it("runs a job queued while no worker was up, through the web services (AC15)", async () => {
    const { jobRunId } = await withContext(prisma, contextA, (tx) =>
      enqueueHelloWorldRecord(tx, contextA, { title: "F3a persisted" }),
    );
    expect((await run(jobRunId)).status).toBe("pending");

    await startWorker("w1");
    const done = await waitFor(() => run(jobRunId), finished);
    expect(done).toMatchObject({
      status: "succeeded",
      attempts: 1,
      lastError: null,
    });
    const recordId = (done.result as { recordId: string }).recordId;
    const record = await admin.helloWorldRecord.findUniqueOrThrow({
      where: { id: recordId },
    });
    expect(record).toMatchObject({
      title: "F3a persisted",
      createdBy: ids.userA,
    });
  });

  it("never applies the effect twice, even when delivered twice", async () => {
    const { jobRunId } = await withContext(prisma, contextA, (tx) =>
      enqueueHelloWorldRecord(tx, contextA, { title: "F3a once" }),
    );
    await startWorker("w1");
    await waitFor(() => run(jobRunId), finished);

    // A second delivery of the same run, as at-least-once queues may do.
    const boss = new PgBoss({
      connectionString: workerUrl ?? "",
      schema: "pgboss",
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.send(queueName(createRecordJob.kind), { jobRunId });
    await boss.stop({ graceful: false });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(
      await admin.helloWorldRecord.count({ where: { title: "F3a once" } }),
    ).toBe(1);
    expect((await run(jobRunId)).attempts).toBe(1);
  });

  it("skips the effect when the requester lost access after enqueuing", async () => {
    const { jobRunId } = await withContext(prisma, editorCtx, (tx) =>
      enqueueHelloWorldRecord(tx, editorCtx, { title: "F3a revoked" }),
    );
    await admin.$executeRawUnsafe(
      `update public.workspace_members set status = 'inactive' where user_id = '${editor}' and workspace_id = '${ids.workspaceA}'`,
    );
    await startWorker("w1");
    const done = await waitFor(() => run(jobRunId), finished);
    expect(done.status).toBe("skipped");
    expect(done.lastError).toContain("não tem mais acesso");
    expect(
      await admin.helloWorldRecord.count({ where: { title: "F3a revoked" } }),
    ).toBe(0);
  });

  it("retries with backoff, then fails to the dead letter; owners retry it", async () => {
    const { id } = await withContext(prisma, contextA, (tx) =>
      enqueueJob(tx, contextA, failingJob, {}),
    );
    await startWorker("w1");
    const failed = await waitFor(
      () => run(id),
      (r) => r.status === "failed",
      30_000,
    );
    expect(failed).toMatchObject({
      attempts: 2,
      lastError: "Não foi possível concluir a operação.",
    });

    const dead = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from pgboss.job where name = $1 and data->>'jobRunId' = $2`,
      DEAD_LETTER_QUEUE,
      id,
    );
    expect(Number(dead[0]?.n)).toBe(1);

    await withContext(prisma, contextA, (tx) => retryJobRun(tx, contextA, id));
    const again = await waitFor(
      () => run(id),
      (r) => r.status === "failed" && r.attempts === 2,
      30_000,
    );
    expect(again.status).toBe("failed");
    await expect(
      withContext(prisma, contextA, (tx) => retryJobRun(tx, contextA, id)),
    ).resolves.toBeUndefined();
  });

  it("keeps one job per workspace at a time across two workers", async () => {
    inFlight = new Map();
    maxInFlight = new Map();
    maxOverall = 0;
    const ids_: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids_.push(
        (
          await withContext(prisma, contextA, (tx) =>
            enqueueJob(tx, contextA, slowJob, { ms: 400 }),
          )
        ).id,
      );
    }
    for (let i = 0; i < 2; i += 1) {
      ids_.push(
        (
          await withContext(prisma, contextB, (tx) =>
            enqueueJob(tx, contextB, slowJob, { ms: 400 }),
          )
        ).id,
      );
    }
    await Promise.all([startWorker("w1"), startWorker("w2")]);
    for (const id of ids_) await waitFor(() => run(id), finished, 30_000);

    expect(maxInFlight.get(ids.workspaceA)).toBe(1);
    expect(maxInFlight.get(ids.workspaceB)).toBe(1);
    // Different workspaces still run side by side.
    expect(maxOverall).toBe(2);
  });
});
