import type { CoreLifecycleResource } from "@/core/privacy/contract";

import { matrixConfig } from "./config";
import { requestWorkspaceSync } from "./jobs";
import { purgeWorkspaceRooms } from "./rooms";
import { createSynapseClient } from "./synapse";

/**
 * What the Matrix core does over the life of a workspace (ADR 0023, rule
 * 12), listed in the hook registry of the soft deletion (WS1):
 *
 * - `onDeletionScheduled` and `onDeletionCanceled` only ask the worker to
 *   reconcile the rooms with the new status: the attendants leave every
 *   room (rooms `blocked`), or come back (rooms `active`). The Matrix jobs
 *   are platform jobs, so the closed workspace does not skip them.
 * - `purgeExternal` deletes the workspace's rooms on Synapse with purge,
 *   before the database purge, in one short app_worker transaction.
 *   Idempotent: a closed room is not deleted again, so a failure is simply
 *   run again. The rows go with the database purge.
 */
export const matrixWorkspaceLifecycle: CoreLifecycleResource = {
  key: "core.matrix",

  async onDeletionScheduled(tx, workspaceId) {
    await requestWorkspaceSync(tx, workspaceId);
  },

  async onDeletionCanceled(tx, workspaceId) {
    await requestWorkspaceSync(tx, workspaceId);
  },

  async purgeExternal(workspaceId, io) {
    const config = matrixConfig();
    if (!config) return { deleted: 0, skipped: true };
    const client = createSynapseClient(config);
    const { deleted } = await io.transaction((tx) =>
      purgeWorkspaceRooms(tx, client, workspaceId),
    );
    return { deleted, skipped: false };
  },
};
