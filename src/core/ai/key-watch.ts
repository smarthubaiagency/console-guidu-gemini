import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { definePlatformJob, type JobSchedule } from "@/core/jobs/definition";
import { dispatchEvent } from "@/core/events/dispatch";
import { emitEvent, WORKER_ACTOR } from "@/core/events/emit";
import { getNotificationTransport } from "@/core/notifications/transport";
import type { NotificationTransport } from "@/core/notifications/types";
import { partnerConsoleOrigin } from "@/core/partners/console-origin";
import { isWorkspaceActive } from "@/core/workspaces/active";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { BACKUP_WINDOW_MS } from "./backup";

/**
 * Notices and pause of the backup (A2c, especificação §9.2), a platform job
 * (app_worker, no user) that runs every 15 minutes:
 *
 * - a GUIDS in backup gets its first notice (once per backup);
 * - one in backup for 24 hours is paused (`status = paused`, `key_state =
 *   failed`) and gets the second notice.
 *
 * Each notice is an event of the Event Hub (H1), `ai.agent.key_backup` or
 * `ai.agent.key_paused` with the route `service_mode`, dispatched at once:
 * in the standard mode it goes to the active owners and admins of the
 * workspace, at the e-mail of their accepted invitation (the only e-mail of
 * a member the application keeps), with the partner's brand and the link
 * to the workspace's keys; in the managed mode, to the managing partner's
 * team. Each delivery is recorded once per key, as "não enviada" while
 * there is no e-mail provider (D-PA-08). Each person also gets the notice
 * in the bell (CF3c), even without a known e-mail. The panel shows the
 * agent's `key_state` (A3 and A4). Safe to run again.
 */

export const KEY_WATCH_JOB_KIND = "ai-agents.key-watch";
const INTERVAL_MS = 15 * 60 * 1000;

export type KeyWatchResult = Readonly<{
  inBackup: number;
  paused: number;
  notices: number;
}>;

type Agent = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  backupStartedAt: Date;
}>;

type NoticeContext = Readonly<{
  partnerId: string;
  workspaceName: string;
  credentialsUrl: string;
}>;

/** The workspace's name and the link to its keys, on the partner's domain. */
async function noticeContextOf(
  tx: ContextTransaction,
  agent: Agent,
): Promise<NoticeContext | null> {
  const [workspace, organization] = await Promise.all([
    tx.workspace.findFirst({
      where: { id: agent.workspaceId },
      select: { name: true, slug: true },
    }),
    tx.organization.findUnique({
      where: { id: agent.organizationId },
      select: { partnerId: true },
    }),
  ]);
  if (!workspace || !organization?.partnerId) return null;
  const partnerId = organization.partnerId;
  // The customer's console on the partner's domain (custom first).
  const origin = await partnerConsoleOrigin(tx, partnerId);
  return {
    partnerId,
    workspaceName: workspace.name,
    credentialsUrl: new URL(
      `/app/${workspace.slug}/settings/credentials`,
      origin,
    ).toString(),
  };
}

export async function runKeyWatch(
  tx: ContextTransaction,
  now: Date = new Date(),
  transport: NotificationTransport = getNotificationTransport(),
): Promise<KeyWatchResult> {
  const rows = await tx.aiAgent.findMany({
    where: { kind: "guid", keyState: "backup" },
    orderBy: { backupStartedAt: "asc" },
    select: {
      id: true,
      organizationId: true,
      workspaceId: true,
      backupStartedAt: true,
    },
  });
  let paused = 0;
  let notices = 0;

  for (const row of rows) {
    if (!row.organizationId || !row.workspaceId || !row.backupStartedAt) {
      continue;
    }
    // A closed workspace (WS1) gets neither the pause nor the notices.
    if (!(await isWorkspaceActive(tx, row.workspaceId))) continue;
    const agent: Agent = {
      id: row.id,
      organizationId: row.organizationId,
      workspaceId: row.workspaceId,
      backupStartedAt: row.backupStartedAt,
    };
    const backupUntil = new Date(
      agent.backupStartedAt.getTime() + BACKUP_WINDOW_MS,
    );
    let type: "ai.agent.key_backup" | "ai.agent.key_paused" =
      "ai.agent.key_backup";
    if (backupUntil.getTime() <= now.getTime()) {
      // Only from the state read: a key test meanwhile wins.
      const changed = await tx.aiAgent.updateMany({
        where: {
          id: agent.id,
          keyState: "backup",
          backupStartedAt: agent.backupStartedAt,
        },
        data: { status: "paused", keyState: "failed" },
      });
      if (changed.count === 0) continue;
      paused += 1;
      type = "ai.agent.key_paused";
      await recordAudit(
        tx,
        {
          userId: "",
          workspaceId: "",
          organizationId: "",
          principalType: "service",
        },
        {
          action: "ai.agent.key_paused",
          resourceType: "ai_agent",
          resourceId: agent.id,
          result: "success",
          origin: "worker",
          metadata: {
            target: agent.workspaceId,
            agentId: agent.id,
            from: "backup",
            to: "failed",
            reason: "backup_expired",
          },
        },
      );
    }

    const context = await noticeContextOf(tx, agent);
    if (!context) continue;
    const emitted = await emitEvent(tx, {
      type,
      actor: WORKER_ACTOR,
      partnerId: context.partnerId,
      organizationId: agent.organizationId,
      workspaceId: agent.workspaceId,
      subject: { type: "ai_agent", id: agent.id },
      data: {
        workspaceName: context.workspaceName,
        agentName: null,
        backupUntil: backupUntil.toISOString(),
        credentialsUrl: context.credentialsUrl,
      },
      idempotencyKey: `ai-key:${agent.id}:${agent.backupStartedAt.toISOString()}:${type}`,
    });
    // At once, in this run (the queued dispatch then finds it done).
    if (emitted.created) {
      notices += (await dispatchEvent(tx, emitted.id, { transport })).notices;
    }
  }
  return { inBackup: rows.length - paused, paused, notices };
}

export const keyWatchJob = definePlatformJob({
  kind: KEY_WATCH_JOB_KIND,
  description:
    "Avisa o cliente da chave de IA com falha e pausa o agente após 24 horas.",
  payload: z.object({ at: z.string().max(40) }),
  maxAttempts: 3,
  retryDelaySeconds: 60,
  async run(tx) {
    return runKeyWatch(tx);
  },
});

/** Every 15 minutes; the key is the start of the slot. */
export const keyWatchSchedule: JobSchedule = {
  kind: KEY_WATCH_JOB_KIND,
  description: "A cada 15 minutos.",
  due(now) {
    const slot = new Date(
      Math.floor(now.getTime() / INTERVAL_MS) * INTERVAL_MS,
    );
    const at = slot.toISOString();
    return { key: at, payload: { at } };
  },
};
