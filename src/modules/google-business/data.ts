import type { ModuleDataContract } from "@/core/privacy/contract";

import { exportMapsData, purgeMapsData } from "./maps/data";

/**
 * Export and purge of the Google fichas (F3e contract): GB1a tables and the
 * Saúde no Maps data of GB1b. The units stay with the core
 * (`workspace_locations`); the purge runs before them.
 */
export const googleBusinessDataContract: ModuleDataContract = {
  moduleKey: "google-business",
  async export(tx, ctx) {
    const where = { workspaceId: ctx.workspaceId };
    const [locations, snapshots, analyses, areas] = await Promise.all([
      tx.gbLocation.findMany({ where, orderBy: { createdAt: "asc" } }),
      tx.gbSnapshot.findMany({ where, orderBy: { createdAt: "asc" } }),
      tx.gbAnalysisRun.findMany({ where, orderBy: { createdAt: "asc" } }),
      tx.gbAreaSetting.findMany({ where, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      locations,
      snapshots,
      analyses,
      areas,
      ...(await exportMapsData(tx, ctx)),
    };
  },
  async purge(tx, workspaceId) {
    const maps = await purgeMapsData(tx, workspaceId);
    const where = { workspaceId };
    const areas = await tx.gbAreaSetting.deleteMany({ where });
    const analyses = await tx.gbAnalysisRun.deleteMany({ where });
    const snapshots = await tx.gbSnapshot.deleteMany({ where });
    const locations = await tx.gbLocation.deleteMany({ where });
    return {
      ...maps,
      gb_area_settings: areas.count,
      gb_analysis_runs: analyses.count,
      gb_snapshots: snapshots.count,
      gb_locations: locations.count,
    };
  },
};
