import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { appConfig } from "@/core/config/app";
import { definePlatformJob, type JobSchedule } from "@/core/jobs/definition";
import { deliverNotification } from "@/core/notifications/delivery";
import { notificationLanguages } from "@/core/notifications/language";
import { getNotificationTransport } from "@/core/notifications/transport";
import type {
  NotificationBrand,
  NotificationTransport,
} from "@/core/notifications/types";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { partnerHostOrigin } from "@/core/partners/hosts";
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
 * The notices go to the active owners and admins of the workspace, at the
 * e-mail of their accepted invitation (the only e-mail of a member the
 * application keeps), with the partner's brand and the link to the
 * workspace's keys; each delivery is recorded once per key, as "não
 * enviada" while there is no e-mail provider (D-PA-08). The panel shows the
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

type Audience = Readonly<{
  partnerId: string;
  workspaceName: string;
  emails: readonly string[];
  credentialsUrl: string;
  brand: NotificationBrand;
}>;

async function audienceOf(
  tx: ContextTransaction,
  agent: Agent,
): Promise<Audience | null> {
  const [workspace, organization, members] = await Promise.all([
    tx.workspace.findFirst({
      where: { id: agent.workspaceId },
      select: { name: true, slug: true },
    }),
    tx.organization.findUnique({
      where: { id: agent.organizationId },
      select: { partnerId: true },
    }),
    // Raw: the worker reads only these columns of members and invitations.
    tx.$queryRaw<{ user_id: string }[]>`
      select user_id from public.workspace_members
      where workspace_id = ${agent.workspaceId}::uuid and status = 'active'
        and role in ('owner', 'admin') and support_grant_id is null
    `,
  ]);
  if (!workspace || !organization?.partnerId) return null;
  const partnerId = organization.partnerId;
  const userIds = members.map((m) => m.user_id);
  const [invitations, partner, domains] = await Promise.all([
    userIds.length > 0
      ? tx.$queryRaw<{ email: string; accepted_by_user_id: string }[]>`
          select email, accepted_by_user_id from public.invitations
          where organization_id = ${agent.organizationId}::uuid and status = 'accepted'
            and accepted_by_user_id = any(${userIds}::uuid[])
          order by accepted_at desc
        `
      : [],
    tx.partner.findUnique({
      where: { id: partnerId },
      select: { name: true, isHouse: true },
    }),
    tx.partnerDomain.findMany({
      where: { partnerId, status: "active" },
      orderBy: { host: "asc" },
      select: { host: true, kind: true },
    }),
  ]);
  // The latest accepted invitation of each person.
  const byUser = new Map<string, string>();
  for (const invitation of invitations) {
    const userId = invitation.accepted_by_user_id;
    if (userId && !byUser.has(userId)) {
      byUser.set(userId, invitation.email.trim().toLowerCase());
    }
  }
  const house = !partner || partner.isHouse || partnerId === HOUSE_PARTNER_ID;
  // The customer's console on the partner's domain (custom first); the
  // platform host for the house or a partner still without a domain.
  const domain = domains.find((d) => d.kind === "custom") ?? domains[0] ?? null;
  const origin =
    house || !domain
      ? appConfig.url
      : partnerHostOrigin(domain.host, process.env);
  return {
    partnerId,
    workspaceName: workspace.name,
    emails: [...new Set(byUser.values())].filter((e) => e.length > 0),
    credentialsUrl: new URL(
      `/app/${workspace.slug}/settings/credentials`,
      origin,
    ).toString(),
    brand: {
      name: house ? appConfig.name : partner.name,
      supportEmail: null,
      supportUrl: null,
    },
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
  const languageOf = notificationLanguages(tx);
  let paused = 0;
  let notices = 0;

  for (const row of rows) {
    if (!row.organizationId || !row.workspaceId || !row.backupStartedAt) {
      continue;
    }
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

    const audience = await audienceOf(tx, agent);
    if (!audience) continue;
    for (const email of audience.emails) {
      notices += await deliverNotification(tx, {
        transport,
        language: await languageOf(email),
        brand: audience.brand,
        partnerId: audience.partnerId,
        relatedId: agent.id,
        event: {
          type,
          recipientEmail: email,
          idempotencyKey: `ai-key:${agent.id}:${agent.backupStartedAt.toISOString()}:${type}:${email}`,
          data: {
            workspaceName: audience.workspaceName,
            agentName: null,
            backupUntil,
            credentialsUrl: audience.credentialsUrl,
          },
        },
      });
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
