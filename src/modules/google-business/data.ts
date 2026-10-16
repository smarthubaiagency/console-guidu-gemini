import type { ModuleDataContract } from "@/core/privacy/contract";

import { exportMapsData, purgeMapsData } from "./maps/data";

/**
 * Export and purge of the Google Business module (F3e contract). GB1b
 * brings the Saúde no Maps data; the GB1a tables join here.
 */
export const googleBusinessDataContract: ModuleDataContract = {
  moduleKey: "google-business",
  async export(tx, ctx) {
    return { ...(await exportMapsData(tx, ctx)) };
  },
  async purge(tx, workspaceId) {
    return { ...(await purgeMapsData(tx, workspaceId)) };
  },
};
