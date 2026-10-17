import { z } from "zod";

import { definePlatformJob, type JobSchedule } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { syncAccount } from "./accounts";
import { ensureWorkspaceAddress } from "./addresses";
import { syncWorkspaceAgent } from "./agent";
import { matrixConfig, matrixEnabled } from "./config";
import { processPendingEvents } from "./events";
import { cleanupRooms, syncWorkspaceRooms } from "./rooms";
import {
  createSynapseClient,
  deleteAllDevices,
  type SynapseClient,
} from "./synapse";

/**
 * Jobs of the Matrix core (IN3), all platform runs as app_worker: they
 * reconcile Synapse with the database, so running one twice changes
 * nothing. The web and the worker ask for them through
 * `private.matrix_enqueue`, which keeps one pending run per kind and
 * payload. With Matrix off nothing is enqueued and a leftover run is
 * skipped.
 */

type MatrixJobKind =
  | "matrix.process-events"
  | "matrix.sync-account"
  | "matrix.sync-workspace"
  | "matrix.logout-devices"
  | "matrix.sync-agent";

export async function enqueueMatrixJob(
  tx: ContextTransaction,
  kind: MatrixJobKind,
  payload: Record<string, string>,
  runAfter?: Date,
): Promise<void> {
  if (!matrixEnabled()) return;
  await tx.$queryRaw`
    select private.matrix_enqueue(${kind}, ${JSON.stringify(payload)}::jsonb, ${runAfter ?? null}::timestamptz)
  `;
}

/** Someone's access to the Inbox may have changed: reconcile their account. */
export function requestAccountSync(
  tx: ContextTransaction,
  userId: string,
): Promise<void> {
  return enqueueMatrixJob(tx, "matrix.sync-account", { userId });
}

/** A workspace changed status: block or restore its rooms. */
export function requestWorkspaceSync(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<void> {
  return enqueueMatrixJob(tx, "matrix.sync-workspace", { workspaceId });
}

/** The Inbox GUIDS of a workspace changed: its user joins the rooms (IN6). */
export function requestAgentSync(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<void> {
  return enqueueMatrixJob(tx, "matrix.sync-agent", { workspaceId });
}

/** The person signed out of the console: end their Matrix sessions. */
export function requestDeviceLogout(
  tx: ContextTransaction,
  userId: string,
): Promise<void> {
  return enqueueMatrixJob(tx, "matrix.logout-devices", { userId });
}

function client(): SynapseClient {
  const config = matrixConfig();
  if (!config) throw new SkipJobError("Matrix não configurado.");
  return createSynapseClient(config);
}

const uuid = z.string().uuid();

export const matrixProcessEventsJob = definePlatformJob<Record<string, never>>({
  kind: "matrix.process-events",
  description:
    "Processa os eventos recebidos do Application Service do Matrix.",
  payload: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  maxAttempts: 5,
  retryDelaySeconds: 10,
  async run(tx) {
    const result = await processPendingEvents(tx, client());
    if (result.more) {
      await enqueueMatrixJob(tx, "matrix.process-events", {});
    } else if (result.waiting > 0) {
      // Events of a room whose row is not committed yet: look again soon.
      await enqueueMatrixJob(
        tx,
        "matrix.process-events",
        {},
        new Date(Date.now() + 30_000),
      );
    }
    return {
      processed: result.processed,
      ignored: result.ignored,
      refused: result.refused,
      waiting: result.waiting,
      failed: result.failed,
    };
  },
});

export const matrixSyncAccountJob = definePlatformJob<{ userId: string }>({
  kind: "matrix.sync-account",
  description:
    "Cria, ajusta ou desativa a conta Matrix de uma pessoa e as salas em que ela está.",
  payload: z.object({ userId: uuid }).strict(),
  maxAttempts: 5,
  retryDelaySeconds: 30,
  async run(tx, payload) {
    const result = await syncAccount(tx, client(), payload.userId);
    if (result.more) await requestAccountSync(tx, payload.userId);
    return {
      status: result.status,
      joined: result.joined,
      removed: result.removed,
    };
  },
});

export const matrixSyncWorkspaceJob = definePlatformJob<{
  workspaceId: string;
}>({
  kind: "matrix.sync-workspace",
  description:
    "Bloqueia ou devolve as salas de um workspace conforme a situação dele e mantém o endereço da loja no chat.",
  payload: z.object({ workspaceId: uuid }).strict(),
  maxAttempts: 5,
  retryDelaySeconds: 30,
  async run(tx, payload) {
    const synapse = client();
    const result = await syncWorkspaceRooms(tx, synapse, payload.workspaceId);
    if (result.more) await requestWorkspaceSync(tx, payload.workspaceId);
    // The address of the store (IN4a), only while the workspace is active.
    const address = await ensureWorkspaceAddress(
      tx,
      synapse,
      payload.workspaceId,
    );
    return {
      action: result.action,
      rooms: result.rooms,
      address: address !== null,
    };
  },
});

export const matrixSyncAgentJob = definePlatformJob<{ workspaceId: string }>({
  kind: "matrix.sync-agent",
  description:
    "Põe o GUIDS do Inbox nas salas do workspace e tira os agentes que não atendem mais.",
  payload: z.object({ workspaceId: uuid }).strict(),
  maxAttempts: 5,
  retryDelaySeconds: 30,
  async run(tx, payload) {
    const result = await syncWorkspaceAgent(tx, client(), payload.workspaceId);
    if (result.more) await requestAgentSync(tx, payload.workspaceId);
    return {
      agent: result.agent !== null,
      joined: result.joined,
      removed: result.removed,
    };
  },
});

export const matrixLogoutDevicesJob = definePlatformJob<{ userId: string }>({
  kind: "matrix.logout-devices",
  description: "Encerra as sessões Matrix de quem saiu do console.",
  payload: z.object({ userId: uuid }).strict(),
  maxAttempts: 3,
  retryDelaySeconds: 30,
  async run(tx, payload) {
    const account = await tx.matrixAccount.findUnique({
      where: { profileId: payload.userId },
      select: { mxid: true },
    });
    if (!account) return { devices: 0 };
    return { devices: await deleteAllDevices(client(), account.mxid) };
  },
});

export const matrixCleanupJob = definePlatformJob<{ hour: string }>({
  kind: "matrix.cleanup",
  description:
    "Apaga salas órfãs do Matrix e o registro antigo do Application Service.",
  payload: z.object({ hour: z.string().max(32) }).strict(),
  maxAttempts: 3,
  retryDelaySeconds: 60,
  async run(tx) {
    return { ...(await cleanupRooms(tx, client())) };
  },
});

export const matrixJobs = [
  matrixProcessEventsJob,
  matrixSyncAccountJob,
  matrixSyncWorkspaceJob,
  matrixSyncAgentJob,
  matrixLogoutDevicesJob,
  matrixCleanupJob,
] as const;

/** Hourly cleanup, only while Matrix is configured. */
export const matrixCleanupSchedule: JobSchedule = {
  kind: "matrix.cleanup",
  description: matrixCleanupJob.description,
  due(now) {
    if (!matrixEnabled()) return null;
    const hour = now.toISOString().slice(0, 13);
    return { key: `matrix-cleanup:${hour}`, payload: { hour } };
  },
};
