import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { definePlatformJob, type JobSchedule } from "@/core/jobs/definition";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { listModuleDataContracts } from "./registry";

/**
 * Daily privacy routine (F3e), a platform job run as app_worker:
 *
 * 1. Purge workspaces whose 30-day grace period is over: module data
 *    through each module's contract, then core rows, then the tombstone
 *    (`deleted`, anonymized name and slug) and the deletion record. The
 *    database lets the worker delete only rows of such workspaces.
 * 2. Expire exports past their 24 hours (the file is dropped).
 * 3. Apply retention for enabled categories; all are disabled until the
 *    legal rules, and the database refuses deletes while they are.
 *
 * Running the same day again finds nothing left to do.
 */

const SERVICE_CTX = {
  userId: "",
  workspaceId: "",
  organizationId: "",
  principalType: "service" as const,
};

/** Workspaces purged per run; the rest wait for the next day. */
export const PURGE_BATCH = 20;

export async function purgeWorkspace(
  tx: ContextTransaction,
  workspace: Readonly<{ id: string; organizationId: string }>,
): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  for (const contract of listModuleDataContracts()) {
    Object.assign(summary, await contract.purge(tx, workspace.id));
  }
  const where = { workspaceId: workspace.id };
  const core: Array<[string, () => Promise<{ count: number }>]> = [
    ["workspace_exports", () => tx.workspaceExport.deleteMany({ where })],
    ["job_runs", () => tx.jobRun.deleteMany({ where })],
    ["api_keys", () => tx.apiKey.deleteMany({ where })],
    ["credentials", () => tx.credential.deleteMany({ where })],
    ["invitations", () => tx.invitation.deleteMany({ where })],
    ["workspace_modules", () => tx.workspaceModule.deleteMany({ where })],
    [
      "partner_support_grants",
      () => tx.partnerSupportGrant.deleteMany({ where }),
    ],
    ["workspace_members", () => tx.workspaceMember.deleteMany({ where })],
  ];
  for (const [table, run] of core) {
    summary[table] = (await run()).count;
  }
  const tombstone = await tx.$executeRaw`
    update public.workspaces
    set status = 'deleted', deleted_at = now(), purge_after = null,
        name = 'Workspace excluído', slug = 'excluido-' || id::text
    where id = ${workspace.id}::uuid
  `;
  if (tombstone !== 1)
    throw new Error("workspace purge: tombstone not written");
  await tx.$executeRaw`
    update public.workspace_deletions
    set purged_at = now(), purge_summary = ${JSON.stringify(summary)}::jsonb
    where workspace_id = ${workspace.id}::uuid and purged_at is null and canceled_at is null
  `;
  await recordAudit(tx, SERVICE_CTX, {
    action: "workspace.deletion.purge",
    resourceType: "workspace",
    resourceId: workspace.id,
    result: "success",
    origin: "worker",
    metadata: { target: workspace.organizationId, status: "deleted" },
  });
  return summary;
}

export type PrivacyRunResult = Readonly<{
  date: string;
  purged: number;
  exportsExpired: number;
  retentionDeleted: number;
}>;

export async function runPrivacyMaintenance(
  tx: ContextTransaction,
  date: string,
): Promise<PrivacyRunResult> {
  const due = await tx.$queryRaw<{ id: string; organization_id: string }[]>`
    select id, organization_id from public.workspaces
    where status = 'deletion_scheduled' and purge_after <= now()
    order by purge_after
    limit ${PURGE_BATCH}
  `;
  for (const workspace of due) {
    await purgeWorkspace(tx, {
      id: workspace.id,
      organizationId: workspace.organization_id,
    });
  }

  const exportsExpired = await tx.$executeRaw`
    update public.workspace_exports set status = 'expired', file = null
    where status = 'ready' and expires_at <= now()
  `;

  let retentionDeleted = 0;
  const policies = await tx.retentionPolicy.findMany({
    where: { enabled: true, automated: true, retainDays: { not: null } },
    select: { category: true, retainDays: true },
  });
  for (const policy of policies) {
    const cutoff = new Date(Date.now() - (policy.retainDays ?? 0) * 86_400_000);
    if (policy.category === "job_runs") {
      retentionDeleted += (
        await tx.jobRun.deleteMany({
          where: {
            status: { in: ["succeeded", "failed", "skipped", "canceled"] },
            finishedAt: { lt: cutoff },
          },
        })
      ).count;
    } else if (policy.category === "notification_deliveries") {
      retentionDeleted += (
        await tx.notificationDelivery.deleteMany({
          where: { status: { not: "pending" }, createdAt: { lt: cutoff } },
        })
      ).count;
    }
  }

  return {
    date,
    purged: due.length,
    exportsExpired,
    retentionDeleted,
  };
}

export const privacyMaintenanceJob = definePlatformJob({
  kind: "privacy.daily-maintenance",
  description:
    "Conclui exclusões de workspace vencidas, expira exportações e aplica a retenção ligada.",
  payload: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  maxAttempts: 5,
  retryDelaySeconds: 60,
  expireInSeconds: 900,
  async run(tx, payload) {
    return runPrivacyMaintenance(tx, payload.date);
  },
});

/** Daily, from 03:00 in Brasília (06:00 UTC), keyed by date. */
export const privacySchedules: readonly JobSchedule[] = [
  {
    kind: privacyMaintenanceJob.kind,
    description: "Diária, a partir das 03:00 (Brasília).",
    due(now) {
      if (now.getUTCHours() < 6) return null;
      const date = now.toISOString().slice(0, 10);
      return { key: date, payload: { date } };
    },
  },
];

export const privacyJobs = [privacyMaintenanceJob] as const;
