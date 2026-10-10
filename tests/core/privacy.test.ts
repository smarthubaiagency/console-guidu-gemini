import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveWorkspaceContext } from "@/core/auth/context";
import type { JobDefinition } from "@/core/jobs/definition";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  cancelWorkspaceDeletion,
  listScheduledDeletions,
  requestWorkspaceDeletion,
} from "@/core/privacy/deletion";
import {
  EXPORT_FORMAT,
  loadExportFile,
  requestWorkspaceExport,
  workspaceExportJob,
} from "@/core/privacy/export";
import { runPrivacyMaintenance } from "@/core/privacy/maintenance";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";
import { createJobWorker } from "@/worker/runtime";

import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

/** Fixture profiles (membership-seed.sql) used as owner, admin and viewer. */
const owner = "d0000000-0000-4000-8000-000000000007";
const admin = "d0000000-0000-4000-8000-000000000008";
const viewer = "d0000000-0000-4000-8000-000000000009";
const mfa = { mfaVerified: true };

// Each run gets its own workspace: a purged one stays as a tombstone, since
// audit events (append-only) keep pointing at it.
const organizationId = randomUUID();
const workspaceId = randomUUID();
const slug = `f3e-${workspaceId.slice(0, 8)}`;

describeDatabase("F3e: workspace export and deletion", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const db = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });

  const contextOf = (userId: string) =>
    resolveWorkspaceContext(prisma, userId, slug, HOUSE_PARTNER_ID);

  beforeAll(async () => {
    await db.$executeRawUnsafe(
      `insert into public.organizations (id, name) values ('${organizationId}', 'Empresa F3e')`,
    );
    await db.$executeRawUnsafe(
      `insert into public.workspaces (id, organization_id, slug, name)
       values ('${workspaceId}', '${organizationId}', '${slug}', 'Workspace F3e')`,
    );
    await db.$executeRawUnsafe(
      `insert into public.workspace_members (workspace_id, organization_id, user_id, role) values
        ('${workspaceId}', '${organizationId}', '${owner}', 'owner'),
        ('${workspaceId}', '${organizationId}', '${admin}', 'admin'),
        ('${workspaceId}', '${organizationId}', '${viewer}', 'viewer')`,
    );
    await db.$executeRawUnsafe(
      `insert into public.hello_world_records (organization_id, workspace_id, title, created_by)
       values ('${organizationId}', '${workspaceId}', 'Registro F3e', '${owner}')`,
    );
    await db.$executeRawUnsafe(
      `insert into public.api_keys (organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
       values ('${organizationId}', '${workspaceId}', '${owner}', 'Chave F3e', 'gdu_live_f3e',
               'hash-secreto-f3e', '{workspace:read}', now() + interval '30 days')`,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.$disconnect();
    await workerDb.$disconnect();
  });

  it("exports the workspace through the job, without secrets (AC12)", async () => {
    const ownerCtx = await contextOf(owner);
    const viewerCtx = await contextOf(viewer);
    await expect(
      withContext(prisma, viewerCtx, (tx) =>
        requestWorkspaceExport(tx, viewerCtx, mfa),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      withContext(prisma, ownerCtx, (tx) =>
        requestWorkspaceExport(tx, ownerCtx, { mfaVerified: false }),
      ),
    ).rejects.toBeInstanceOf(AppError);

    const { exportId } = await withContext(prisma, ownerCtx, (tx) =>
      requestWorkspaceExport(tx, ownerCtx, mfa),
    );
    const worker = createJobWorker({
      databaseUrl: workerUrl ?? "",
      definitions: [
        workspaceExportJob,
      ] as unknown as readonly JobDefinition<unknown>[],
      schedules: [],
      dispatchIntervalMs: 200,
      pollingIntervalSeconds: 0.5,
      instanceName: "f3e-test",
      log: () => {},
    });
    await worker.start();
    try {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const row = await db.workspaceExport.findUniqueOrThrow({
          where: { id: exportId },
        });
        if (row.status === "ready" || row.status === "failed") {
          expect(row.status).toBe("ready");
          break;
        }
        if (Date.now() > deadline) throw new Error(`timeout: ${row.status}`);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } finally {
      await worker.stop();
    }

    // The admin downloads it too; the content has the data and no secret.
    const adminCtx = await contextOf(admin);
    const file = await withContext(prisma, adminCtx, (tx) =>
      loadExportFile(tx, adminCtx, exportId, mfa),
    );
    const text = file.file.toString("utf8");
    const data = JSON.parse(text) as {
      format: string;
      workspace: { slug: string };
      core: { members: unknown[]; apiKeys: Array<{ prefix: string }> };
      modules: Record<string, Record<string, Array<{ title?: string }>>>;
    };
    expect(data.format).toBe(EXPORT_FORMAT);
    expect(data.workspace.slug).toBe(slug);
    expect(data.core.members).toHaveLength(3);
    expect(data.core.apiKeys[0]?.prefix).toBe("gdu_live_f3e");
    expect(data.modules["hello-world"]?.records?.[0]?.title).toBe(
      "Registro F3e",
    );
    expect(text).not.toContain("hash-secreto-f3e");
    expect(text).not.toMatch(/keyHash|key_hash|encryptedPayload|tokenHash/);

    await expect(
      withContext(prisma, viewerCtx, (tx) =>
        loadExportFile(tx, viewerCtx, exportId, mfa),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("schedules the deletion for the owner only and lets them cancel", async () => {
    const adminCtx = await contextOf(admin);
    await expect(
      withContext(prisma, adminCtx, (tx) =>
        requestWorkspaceDeletion(tx, adminCtx, { confirmSlug: slug }, mfa),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const ownerCtx = await contextOf(owner);
    await expect(
      withContext(prisma, ownerCtx, (tx) =>
        requestWorkspaceDeletion(tx, ownerCtx, { confirmSlug: "outro" }, mfa),
      ),
    ).rejects.toBeInstanceOf(AppError);

    await withContext(prisma, ownerCtx, (tx) =>
      requestWorkspaceDeletion(tx, ownerCtx, { confirmSlug: slug }, mfa),
    );
    // Closed to everyone, the owner included.
    await expect(contextOf(owner)).rejects.toThrow();
    await expect(contextOf(viewer)).rejects.toThrow();

    const asOwner = <T>(fn: Parameters<typeof withIdentityContext<T>>[2]) =>
      withIdentityContext(prisma, owner, fn, { partnerId: HOUSE_PARTNER_ID });
    const scheduled = await asOwner((tx) => listScheduledDeletions(tx));
    expect(scheduled.map((d) => d.workspaceId)).toContain(workspaceId);
    await expect(
      withIdentityContext(
        prisma,
        viewer,
        (tx) => cancelWorkspaceDeletion(tx, viewer, workspaceId, mfa),
        { partnerId: HOUSE_PARTNER_ID },
      ),
    ).rejects.toBeInstanceOf(AppError);

    await asOwner((tx) => cancelWorkspaceDeletion(tx, owner, workspaceId, mfa));
    expect((await contextOf(viewer)).workspaceId).toBe(workspaceId);
  });

  it("purges after the grace period, keeps the tombstone and is idempotent", async () => {
    const ownerCtx: RequestContext = await contextOf(owner);
    await withContext(prisma, ownerCtx, (tx) =>
      requestWorkspaceDeletion(tx, ownerCtx, { confirmSlug: slug }, mfa),
    );
    // Not before the grace period.
    const early = await workerDb.$transaction((tx) =>
      runPrivacyMaintenance(tx, "2026-10-17"),
    );
    expect(
      (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
        .status,
    ).toBe("deletion_scheduled");
    expect(early.purged).toBeGreaterThanOrEqual(0);

    await db.$executeRawUnsafe(
      `update public.workspaces set purge_after = now() - interval '1 minute' where id = '${workspaceId}'`,
    );
    await workerDb.$transaction((tx) =>
      runPrivacyMaintenance(tx, "2026-11-17"),
    );

    const tombstone = await db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    expect(tombstone).toMatchObject({
      status: "deleted",
      name: "Workspace excluído",
      slug: `excluido-${workspaceId}`,
    });
    const where = { workspaceId };
    expect(
      await Promise.all([
        db.workspaceMember.count({ where }),
        db.helloWorldRecord.count({ where }),
        db.apiKey.count({ where }),
        db.workspaceExport.count({ where }),
        db.jobRun.count({ where }),
      ]),
    ).toEqual([0, 0, 0, 0, 0]);
    const record = await db.workspaceDeletion.findFirstOrThrow({
      where: { workspaceId, purgedAt: { not: null } },
    });
    expect(record.purgeSummary).toMatchObject({
      workspace_members: 3,
      hello_world_records: 1,
      api_keys: 1,
    });
    const audit = await db.$queryRawUnsafe<{ action: string }[]>(
      `select action from public.audit_events where resource_id = '${workspaceId}'
       order by occurred_at`,
    );
    expect(audit.map((a) => a.action)).toEqual([
      "workspace.deletion.request",
      "workspace.deletion.cancel",
      "workspace.deletion.request",
      "workspace.deletion.purge",
    ]);

    const again = await workerDb.$transaction((tx) =>
      runPrivacyMaintenance(tx, "2026-11-17"),
    );
    expect(again.purged).toBe(0);
  });
});
