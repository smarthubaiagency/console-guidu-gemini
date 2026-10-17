import type { ContextTransaction } from "@/lib/prisma/with-context";

import { matrixConfig } from "./config";
import { requestWorkspaceSync } from "./jobs";
import { purgeWorkspaceRooms } from "./rooms";
import { createSynapseClient } from "./synapse";

/**
 * What the Matrix core does over the life of a workspace (ADR 0023, rule
 * 12), for the hook registry of the soft deletion (WS1), which wires it in:
 *
 * - `onDeletionScheduled` and `onDeletionCanceled` run in the transaction
 *   that changes the workspace (web, app_runtime). They only ask the worker
 *   to reconcile the rooms with the new status: the attendants leave every
 *   room (rooms `blocked`), or come back (rooms `active`).
 * - `purgeExternal` runs in the worker before the database purge, outside
 *   the purge transaction (pass a short app_worker transaction). It deletes
 *   the workspace's rooms on Synapse with purge; idempotent, so a failure
 *   is simply run again. The rows go with the database purge.
 */
type Workspace = Readonly<{ id: string; organizationId?: string }>;

export const matrixWorkspaceLifecycle = {
  key: "matrix",

  async onDeletionScheduled(
    tx: ContextTransaction,
    workspace: Workspace,
  ): Promise<void> {
    await requestWorkspaceSync(tx, workspace.id);
  },

  async onDeletionCanceled(
    tx: ContextTransaction,
    workspace: Workspace,
  ): Promise<void> {
    await requestWorkspaceSync(tx, workspace.id);
  },

  async purgeExternal(
    tx: ContextTransaction,
    workspace: Workspace,
  ): Promise<Readonly<{ deleted: number; skipped: boolean }>> {
    const config = matrixConfig();
    if (!config) return { deleted: 0, skipped: true };
    const { deleted } = await purgeWorkspaceRooms(
      tx,
      createSynapseClient(config),
      workspace.id,
    );
    return { deleted, skipped: false };
  },
} as const;
