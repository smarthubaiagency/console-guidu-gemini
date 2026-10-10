import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadUsage } from "@/core/entitlements/usage";
import { enqueueJob } from "@/core/jobs/service";
import { setWorkspaceModuleStatus } from "@/core/module-runtime/settings";
import { getModuleAccessState } from "@/core/module-runtime/state";
import { ModuleUnavailableError } from "@/core/modules/availability";
import { SeatLimitExceededError } from "@/core/organizations/errors";
import { createInvitation } from "@/core/organizations/invitations";
import { withContext } from "@/lib/prisma/with-context";
import { createRecordJob } from "@/modules/hello-world/jobs";
import {
  createHelloWorldRecord,
  listHelloWorldRecords,
} from "@/modules/hello-world/server/services/records";
import { createJobWorker } from "@/worker/runtime";
import { AppError } from "@/shared/errors";

import { contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const HOUSE = "00000000-0000-4000-8000-000000000000";
const PLAN = "f3b00000-0000-4000-8000-0000000000a1";
const isConflict = (e: unknown) =>
  e instanceof AppError && e.code === "conflict";

describeDatabase(
  "F3b: contract in module access and quotas (AC08)",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });

    /** A plan version with the given modules and limits (test plan). */
    async function version(
      v: number,
      moduleKeys: string[],
      limits: Record<string, number> = {},
    ): Promise<string> {
      const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
        `insert into public.plan_versions
         (plan_id, version, module_keys, min_price_cents, min_platform_share_cents,
          partner_base_price_cents, limits)
       values ($1::uuid, $2, $3::text[], 0, 0, 1000, $4::jsonb) returning id`,
        PLAN,
        v,
        moduleKeys,
        JSON.stringify(limits),
      );
      return rows[0]!.id;
    }

    /** Replaces company B's subscription with one in the given status. */
    async function subscribe(planVersionId: string, status: string) {
      await admin.$executeRawUnsafe(
        `delete from public.subscriptions where organization_id = '${ids.organizationB}'`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.subscriptions
         (partner_id, organization_id, plan_version_id, mode, payer, billing_interval,
          amount_cents, status, canceled_at)
       values ('${HOUSE}', '${ids.organizationB}', '${planVersionId}', 'partner_pays', 'partner',
               'monthly', 1000, '${status}', ${status === "canceled" ? "now()" : "null"})`,
      );
    }

    const state = () =>
      withContext(prisma, contextB, (tx) =>
        getModuleAccessState(tx, contextB, "hello-world"),
      );
    const create = (title: string) =>
      withContext(prisma, contextB, (tx) =>
        createHelloWorldRecord(tx, contextB, { title }),
      );
    const list = () =>
      withContext(prisma, contextB, (tx) =>
        listHelloWorldRecords(tx, contextB),
      );

    async function cleanup() {
      await admin.$executeRawUnsafe(
        `delete from public.subscriptions where organization_id = '${ids.organizationB}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.plan_versions where plan_id = '${PLAN}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.plans where id = '${PLAN}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.hello_world_records where workspace_id = '${ids.workspaceB}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.job_runs where workspace_id = '${ids.workspaceB}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.invitations where organization_id = '${ids.organizationB}' and email like '%@f3b.test'`,
      );
    }

    beforeAll(async () => {
      vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "true");
      await cleanup();
      await admin.$executeRawUnsafe(
        `insert into public.plans (id, key, name) values ('${PLAN}', 'teste-f3b', 'Teste F3b')`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${ids.organizationB}', '${ids.workspaceB}', 'hello-world', 'enabled', '${ids.userB}')
       on conflict (workspace_id, module_key) do update set status = 'enabled'`,
      );
    });

    afterEach(async () => {
      await admin.$executeRawUnsafe(
        `delete from public.hello_world_records where workspace_id = '${ids.workspaceB}'`,
      );
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await cleanup();
      await admin.$executeRawUnsafe(
        `delete from public.workspace_modules where workspace_id = '${ids.workspaceB}' and module_key = 'hello-world'`,
      );
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("keeps a company without subscription as before (legacy)", async () => {
      expect(await state()).toBe("enabled");
      await create("F3b legado");
      expect((await list()).limit).toBe(10);
      const usage = await withContext(prisma, contextB, (tx) =>
        loadUsage(tx, contextB),
      );
      expect(usage.contract.kind).toBe("legacy");
      expect(
        usage.rows.find((r) => r.key === "hello-world.records"),
      ).toMatchObject({
        used: 1,
        limit: 10,
        source: "default",
      });
    });

    it("blocks a module outside the plan in services, settings and the worker", async () => {
      await subscribe(await version(1, ["catalog"]), "active");
      expect(await state()).toBe("not_contracted");
      await expect(list()).rejects.toBeInstanceOf(ModuleUnavailableError);
      await expect(create("F3b fora do plano")).rejects.toThrow(
        "não inclui este módulo",
      );
      await expect(
        withContext(prisma, contextB, (tx) =>
          setWorkspaceModuleStatus(tx, contextB, "hello-world", "enabled"),
        ),
      ).rejects.toSatisfy(isConflict);

      // The worker skips the job at once: the contract holds until changed.
      const { id } = await withContext(prisma, contextB, (tx) =>
        enqueueJob(tx, contextB, createRecordJob, { title: "F3b job" }),
      );
      const worker = createJobWorker({
        databaseUrl: workerUrl ?? "",
        dispatchIntervalMs: 200,
        pollingIntervalSeconds: 0.5,
        log: () => {},
      });
      await worker.start();
      try {
        const deadline = Date.now() + 20_000;
        let run = await admin.jobRun.findUniqueOrThrow({ where: { id } });
        while (
          !["skipped", "failed", "succeeded"].includes(run.status) &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          run = await admin.jobRun.findUniqueOrThrow({ where: { id } });
        }
        expect(run).toMatchObject({ status: "skipped", attempts: 1 });
      } finally {
        await worker.stop();
      }
      expect(
        await admin.helloWorldRecord.count({
          where: { workspaceId: ids.workspaceB },
        }),
      ).toBe(0);
    });

    it("leaves a suspended subscription read only", async () => {
      await subscribe(await version(2, ["hello-world"]), "active");
      await create("F3b antes da suspensão");
      await admin.$executeRawUnsafe(
        `update public.subscriptions set status = 'suspended' where organization_id = '${ids.organizationB}'`,
      );
      expect(await state()).toBe("suspended");
      expect((await list()).records.map((r) => r.title)).toEqual([
        "F3b antes da suspensão",
      ]);
      await expect(create("F3b suspensa")).rejects.toThrow("só para consulta");
    });

    it("blocks a canceled subscription, keeping the data", async () => {
      await subscribe(await version(3, ["hello-world"]), "active");
      await create("F3b antes do cancelamento");
      await admin.$executeRawUnsafe(
        `update public.subscriptions set status = 'canceled', canceled_at = now() where organization_id = '${ids.organizationB}'`,
      );
      expect(await state()).toBe("not_contracted");
      expect(
        await admin.helloWorldRecord.count({
          where: { workspaceId: ids.workspaceB },
        }),
      ).toBe(1);
    });

    it("applies plan limits, under concurrency, and never deletes on a lower limit", async () => {
      await subscribe(
        await version(4, ["hello-world"], { "hello-world.records": 3 }),
        "active",
      );
      expect((await list()).limit).toBe(3);
      await create("F3b 1");
      await create("F3b 2");
      // Two creations race for the last slot: exactly one wins.
      const results = await Promise.allSettled([
        create("F3b 3a"),
        create("F3b 3b"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(AppError);
      expect((rejected.reason as AppError).safeMessage).toContain(
        "Limite do plano atingido",
      );

      // A plan with a lower limit: the 3 records stay, new ones are refused.
      await subscribe(
        await version(5, ["hello-world"], { "hello-world.records": 1 }),
        "active",
      );
      expect((await list()).records).toHaveLength(3);
      await expect(create("F3b depois")).rejects.toSatisfy(isConflict);
      const usage = await withContext(prisma, contextB, (tx) =>
        loadUsage(tx, contextB),
      );
      expect(
        usage.rows.find((r) => r.key === "hello-world.records"),
      ).toMatchObject({
        used: 3,
        limit: 1,
        source: "plan",
      });
    });

    it("takes the seat limit from the plan", async () => {
      const members = await admin.organizationMember.count({
        where: { organizationId: ids.organizationB, status: "active" },
      });
      await subscribe(
        await version(6, ["hello-world"], { "core.seats": members }),
        "active",
      );
      await expect(
        withContext(prisma, contextB, (tx) =>
          createInvitation(tx, {
            organizationId: ids.organizationB,
            actorId: ids.userB,
            email: "novo@f3b.test",
            role: "member",
          }),
        ),
      ).rejects.toBeInstanceOf(SeatLimitExceededError);
      await subscribe(
        await version(7, ["hello-world"], { "core.seats": members + 1 }),
        "active",
      );
      await expect(
        withContext(prisma, contextB, (tx) =>
          createInvitation(tx, {
            organizationId: ids.organizationB,
            actorId: ids.userB,
            email: "novo@f3b.test",
            role: "member",
          }),
        ),
      ).resolves.toMatchObject({ rawToken: expect.any(String) });
    });
  },
);
