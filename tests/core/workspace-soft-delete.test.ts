import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { resolveWorkspaceContext } from "@/core/auth/context";
import { dispatchEvent } from "@/core/events/dispatch";
import { emitEvent, WORKER_ACTOR } from "@/core/events/emit";
import {
  defineDetachedJob,
  type JobDefinition,
  type PlatformJobSession,
} from "@/core/jobs/definition";
import { InvitationWorkspaceClosedError } from "@/core/organizations/errors";
import {
  acceptInvitation,
  hashInvitationToken,
} from "@/core/organizations/invitations";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import {
  cancelWorkspaceDeletion,
  requestWorkspaceDeletion,
} from "@/core/privacy/deletion";
import {
  runWorkspaceLifecycle,
  runWorkspacePurge,
} from "@/core/privacy/lifecycle-jobs";
import type { NamedLifecycleHooks } from "@/core/privacy/lifecycle-registry";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { createRecordJob } from "@/modules/hello-world/jobs";
import { createJobWorker, type JobWorker } from "@/worker/runtime";

import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * WS1: a workspace that is not active runs nothing. The worker skips its
 * jobs quietly (detached ones included), the Event Hub tells nobody but
 * its deletion notices, and the lifecycle runs call the hooks, record them
 * and purge the database only after every external hook succeeded.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

/** Fixture profiles (membership-seed.sql) used as owner and admin. */
const owner = "d0000000-0000-4000-8000-000000000007";
const admin = "d0000000-0000-4000-8000-000000000008";
const mfa = { mfaVerified: true };

const organizationId = randomUUID();
const workspaceId = randomUUID();
const slug = `ws1-${workspaceId.slice(0, 8)}`;

let detachedSessions = 0;
const detachedJob = defineDetachedJob({
  kind: "test.ws1-detached",
  description: "Teste: abre uma transação curta.",
  payload: z.object({}),
  maxAttempts: 1,
  async run(session) {
    await session.transaction(async () => {
      detachedSessions += 1;
    });
    return { ok: true };
  },
});
const definitions = [
  createRecordJob,
  detachedJob,
] as unknown as readonly JobDefinition<unknown>[];

describeDatabase(
  "WS1: complete soft delete of a workspace",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const db = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });
    const workerDb = new PrismaClient({
      datasources: { db: { url: workerUrl ?? "" } },
    });
    const session: Pick<PlatformJobSession, "transaction"> = {
      transaction: (operation) => workerDb.$transaction(operation),
    };
    let worker: JobWorker | null = null;

    const setStatus = (status: "active" | "deletion_scheduled" | "suspended") =>
      db.$executeRawUnsafe(
        status === "deletion_scheduled"
          ? `update public.workspaces set status = 'deletion_scheduled',
             deletion_requested_at = now(), purge_after = now() + interval '30 days'
           where id = '${workspaceId}'`
          : `update public.workspaces set status = '${status}',
             deletion_requested_at = null, deletion_requested_by = null, purge_after = null
           where id = '${workspaceId}'`,
      );

    async function enqueue(kind: string, payload: object): Promise<string> {
      const id = randomUUID();
      await db.$executeRawUnsafe(
        `insert into public.job_runs (id, kind, scope, organization_id, workspace_id, requested_by,
         payload, idempotency_key, max_attempts)
       values ('${id}', '${kind}', 'workspace', '${organizationId}', '${workspaceId}', '${owner}',
               '${JSON.stringify(payload)}'::jsonb, '${id}', 1)`,
      );
      return id;
    }

    async function finished(id: string) {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const run = await db.jobRun.findUniqueOrThrow({ where: { id } });
        if (["succeeded", "failed", "skipped"].includes(run.status)) return run;
        if (Date.now() > deadline) throw new Error(`timeout: ${run.status}`);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    async function startWorker(): Promise<void> {
      worker = createJobWorker({
        databaseUrl: workerUrl ?? "",
        definitions,
        schedules: [],
        concurrency: 2,
        dispatchIntervalMs: 200,
        pollingIntervalSeconds: 0.5,
        maintenanceCacheMs: 0,
        instanceName: "ws1-test",
        log: () => {},
      });
      await worker.start();
    }

    beforeAll(async () => {
      vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "true");
      await db.$executeRawUnsafe(
        `insert into public.organizations (id, name) values ('${organizationId}', 'Empresa WS1')`,
      );
      await db.$executeRawUnsafe(
        `insert into public.workspaces (id, organization_id, slug, name)
       values ('${workspaceId}', '${organizationId}', '${slug}', 'Workspace WS1')`,
      );
      await db.$executeRawUnsafe(
        `insert into public.workspace_members (workspace_id, organization_id, user_id, role) values
        ('${workspaceId}', '${organizationId}', '${owner}', 'owner'),
        ('${workspaceId}', '${organizationId}', '${admin}', 'admin')`,
      );
      await db.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${organizationId}', '${workspaceId}', 'hello-world', 'enabled', '${owner}')`,
      );
    });

    afterEach(async () => {
      await worker?.stop();
      worker = null;
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await db.$executeRawUnsafe(
        `delete from public.job_runs where workspace_id = '${workspaceId}'`,
      );
      await prisma.$disconnect();
      await db.$disconnect();
      await workerDb.$disconnect();
    });

    it("skips the jobs of a closed workspace quietly and runs them again once active", async () => {
      await setStatus("deletion_scheduled");
      const scheduled = await enqueue(createRecordJob.kind, { title: "WS1 a" });
      const detached = await enqueue(detachedJob.kind, {});
      await setStatus("suspended");
      const suspended = await enqueue(createRecordJob.kind, { title: "WS1 b" });
      await startWorker();
      for (const id of [scheduled, detached, suspended]) {
        expect(await finished(id)).toMatchObject({
          status: "skipped",
          lastError: null,
          result: { skipped: "workspace_not_active" },
        });
      }
      expect(detachedSessions).toBe(0);
      expect(await db.helloWorldRecord.count({ where: { workspaceId } })).toBe(
        0,
      );

      await setStatus("active");
      const back = await enqueue(createRecordJob.kind, { title: "WS1 c" });
      const backDetached = await enqueue(detachedJob.kind, {});
      expect(await finished(back)).toMatchObject({ status: "succeeded" });
      expect(await finished(backDetached)).toMatchObject({
        status: "succeeded",
      });
      expect(detachedSessions).toBe(1);
    });

    it("refuses an invitation to a closed workspace and keeps it pending", async () => {
      const invitee = "d0000000-0000-4000-8000-000000000010";
      const email = "ws1-invite@test.guidu.co";
      const rawToken = randomUUID();
      const invitation = await db.invitation.create({
        data: {
          organizationId,
          workspaceId,
          email,
          role: "member",
          tokenHash: hashInvitationToken(rawToken),
          invitedByUserId: owner,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await setStatus("deletion_scheduled");
      try {
        await expect(
          acceptInvitation(prisma, {
            rawToken,
            identity: {
              userId: invitee,
              email,
              emailConfirmedAt: new Date().toISOString(),
              mfaSatisfied: false,
              profile: {
                id: invitee,
                fullName: null,
                status: "active",
                statusReason: null,
                lastSignInAt: null,
              },
            },
          }),
        ).rejects.toThrow(InvitationWorkspaceClosedError);
        expect(
          await db.invitation.findUniqueOrThrow({
            where: { id: invitation.id },
          }),
        ).toMatchObject({ status: "pending" });
        expect(
          await db.workspaceMember.count({
            where: { workspaceId, userId: invitee },
          }),
        ).toBe(0);
      } finally {
        await db.invitation.delete({ where: { id: invitation.id } });
        await setStatus("active");
      }
    });

    it("tells nobody about a closed workspace, except about its deletion", async () => {
      await setStatus("deletion_scheduled");
      const result = await workerDb.$transaction(async (tx) => {
        const data = {
          workspaceName: "Workspace WS1",
          agentName: null,
          backupUntil: new Date().toISOString(),
          credentialsUrl: "https://app.guidu.test/app/x/settings/credentials",
        };
        const other = await emitEvent(tx, {
          type: "ai.agent.key_backup",
          actor: WORKER_ACTOR,
          partnerId: HOUSE_PARTNER_ID,
          organizationId,
          workspaceId,
          data,
          idempotencyKey: `ws1-test:${randomUUID()}`,
        });
        const own = await emitEvent(tx, {
          type: "workspace.deletion.scheduled",
          actor: WORKER_ACTOR,
          partnerId: HOUSE_PARTNER_ID,
          organizationId,
          workspaceId,
          data: {
            workspaceName: "Workspace WS1",
            purgeAfter: new Date().toISOString(),
            appUrl: "https://app.guidu.test/app",
          },
          idempotencyKey: `ws1-test:${randomUUID()}`,
        });
        return {
          other: await dispatchEvent(tx, other.id),
          own: await dispatchEvent(tx, own.id),
        };
      });
      expect(result.other.status).toBe("skipped");
      expect(result.own.status).toBe("dispatched");
      // Owner and admin hear in the bell (no accepted invitation: no e-mail).
      expect(result.own.bell).toBe(2);
      await setStatus("active");
    });

    it("runs the lifecycle hooks, records them and purges only after the external ones", async () => {
      const calls: string[] = [];
      let failExternal = true;
      const hooks: NamedLifecycleHooks[] = [
        {
          key: "test.rooms",
          async onDeletionScheduled(tx, id) {
            // Runs as app_worker in its own transaction.
            await tx.$queryRaw`select 1`;
            calls.push(`scheduled:${id === workspaceId}`);
            return { kicked: 2 };
          },
          async onDeletionCanceled() {
            calls.push("canceled");
          },
          async purgeExternal() {
            calls.push("external:rooms");
            if (failExternal) throw new Error("synapse offline");
            return { rooms: 3 };
          },
        },
        {
          key: "test.cdn",
          async purgeExternal() {
            calls.push("external:cdn");
          },
        },
      ];
      const contextOf = () =>
        resolveWorkspaceContext(prisma, owner, slug, HOUSE_PARTNER_ID);

      // Schedule, then cancel: each queues its lifecycle run.
      let ctx = await contextOf();
      const first = await withContext(prisma, ctx, (tx) =>
        requestWorkspaceDeletion(tx, ctx, { confirmSlug: slug }, mfa),
      );
      const runs = await db.jobRun.findMany({
        where: { kind: "privacy.workspace-lifecycle" },
        select: { payload: true, scope: true, status: true },
      });
      expect(runs).toContainEqual({
        payload: { deletionId: first.deletionId, action: "scheduled" },
        scope: "platform",
        status: "pending",
      });
      expect(
        await runWorkspaceLifecycle(
          session,
          { deletionId: first.deletionId, action: "scheduled" },
          { hooks: () => hooks },
        ),
      ).toMatchObject({ status: "done", hooks: 1 });
      // Again: the hook already done is not repeated, nor the notice.
      expect(
        await runWorkspaceLifecycle(
          session,
          { deletionId: first.deletionId, action: "scheduled" },
          { hooks: () => hooks },
        ),
      ).toMatchObject({ status: "done", hooks: 0, notices: 0 });
      expect(calls).toEqual(["scheduled:true"]);

      await withIdentityContext(
        prisma,
        owner,
        (tx) => cancelWorkspaceDeletion(tx, owner, workspaceId, mfa),
        { partnerId: HOUSE_PARTNER_ID },
      );
      // The late scheduled run of a canceled deletion does nothing.
      expect(
        await runWorkspaceLifecycle(
          session,
          { deletionId: first.deletionId, action: "scheduled" },
          { hooks: () => hooks },
        ),
      ).toEqual({ status: "superseded" });
      await runWorkspaceLifecycle(
        session,
        { deletionId: first.deletionId, action: "canceled" },
        { hooks: () => hooks },
      );
      expect(calls).toEqual(["scheduled:true", "canceled"]);
      const canceled = await db.workspaceDeletion.findUniqueOrThrow({
        where: { id: first.deletionId },
      });
      expect(canceled.lifecycle).toMatchObject({
        scheduled: { "test.rooms": { status: "ok", result: { kicked: 2 } } },
        canceled: { "test.rooms": { status: "ok" } },
        notices: {
          scheduled: expect.any(String),
          canceled: expect.any(String),
        },
      });
      const notices = await db.$queryRawUnsafe<{ type: string }[]>(
        `select type from public.events where workspace_id = '${workspaceId}'
         and idempotency_key like 'workspace-deletion:%' order by occurred_at`,
      );
      expect(notices.map((n) => n.type)).toEqual([
        "workspace.deletion.scheduled",
        "workspace.deletion.canceled",
      ]);

      // Schedule again and let the grace period end.
      ctx = await contextOf();
      const second = await withContext(prisma, ctx, (tx) =>
        requestWorkspaceDeletion(tx, ctx, { confirmSlug: slug }, mfa),
      );
      await db.$executeRawUnsafe(
        `update public.workspaces set purge_after = now() - interval '1 minute' where id = '${workspaceId}'`,
      );
      calls.length = 0;
      await expect(
        runWorkspacePurge(session, { workspaceId }, { hooks: () => hooks }),
      ).rejects.toThrow(/test\.rooms/);
      // Every external hook ran; the database waits.
      expect(calls).toEqual(["external:rooms", "external:cdn"]);
      expect(
        (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
          .status,
      ).toBe("deletion_scheduled");
      expect(await db.workspaceMember.count({ where: { workspaceId } })).toBe(
        2,
      );

      // The retry repeats only what failed, then purges.
      failExternal = false;
      calls.length = 0;
      expect(
        await runWorkspacePurge(
          session,
          { workspaceId },
          { hooks: () => hooks },
        ),
      ).toMatchObject({ status: "purged", external: 2 });
      expect(calls).toEqual(["external:rooms"]);
      const purged = await db.workspaceDeletion.findUniqueOrThrow({
        where: { id: second.deletionId },
      });
      expect(purged.purgedAt).not.toBeNull();
      expect(purged.lifecycle).toMatchObject({
        external: {
          "test.rooms": { status: "ok", attempts: 2, result: { rooms: 3 } },
          "test.cdn": { status: "ok", attempts: 1 },
        },
        notices: { completed: expect.any(String) },
      });
      expect(
        (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
          .status,
      ).toBe("deleted");
      expect(await db.workspaceMember.count({ where: { workspaceId } })).toBe(
        0,
      );
    });
  },
);
