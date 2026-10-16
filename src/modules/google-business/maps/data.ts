import type { ExportedRows } from "@/core/privacy/contract";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Export and purge of the Saúde no Maps data (GB1b, F3e). Plugged into the
 * module data contract in `../data.ts`; the purge runs as app_worker for a
 * workspace past its grace period, children first.
 */

export async function exportMapsData(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<Record<string, ExportedRows>> {
  const where = { workspaceId: ctx.workspaceId };
  const [keywords, competitors, scans, results] = await Promise.all([
    tx.gbMapsKeyword.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        locationId: true,
        keyword: true,
        source: true,
        status: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    tx.gbMapsCompetitor.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        locationId: true,
        placeId: true,
        source: true,
        status: true,
        createdAt: true,
      },
    }),
    tx.gbMapsScan.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 5000,
    }),
    tx.gbMapsScanResult.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50_000,
    }),
  ]);
  return {
    maps_keywords: keywords,
    maps_competitors: competitors,
    maps_scans: scans.map((scan) => ({
      ...scan,
      costEstimateMicros: Number(scan.costEstimateMicros),
    })),
    maps_scan_results: results.map((result) => ({
      ...result,
      solv: Number(result.solv),
      averageRank:
        result.averageRank === null ? null : Number(result.averageRank),
    })),
  };
}

export async function purgeMapsData(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<Record<string, number>> {
  const where = { workspaceId };
  const results = await tx.gbMapsScanResult.deleteMany({ where });
  const scans = await tx.gbMapsScan.deleteMany({ where });
  const competitors = await tx.gbMapsCompetitor.deleteMany({ where });
  const keywords = await tx.gbMapsKeyword.deleteMany({ where });
  return {
    gb_maps_scan_results: results.count,
    gb_maps_scans: scans.count,
    gb_maps_competitors: competitors.count,
    gb_maps_keywords: keywords.count,
  };
}
