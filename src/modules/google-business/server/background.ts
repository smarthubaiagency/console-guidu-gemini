import "server-only";

import type { RequestContext } from "@/lib/prisma/with-context";

import { analysisByKey, type Db, runAnalysis } from "./runner";
import { locationForRun } from "./inputs";

/**
 * Background analyses of a ficha (GB1a): those of the registry with phase
 * `background` that did not finish yet, run one after the other by the job
 * of the worker (`jobs.ts`), each in its own short transactions.
 */
export async function runBackgroundAnalyses(
  db: Db,
  ctx: RequestContext,
  locationId: string,
  timeoutMs: number,
): Promise<{ ran: number; failed: number; name: string }> {
  const input = await db((tx) => locationForRun(tx, ctx, locationId));
  const pending = await db((tx) =>
    tx.gbAnalysisRun.findMany({
      where: {
        gbLocationId: locationId,
        phase: "background",
        status: { in: ["pending", "running", "failed"] },
      },
      select: { analysisKey: true },
    }),
  );
  let failed = 0;
  let ran = 0;
  for (const row of pending) {
    const analysis = analysisByKey(row.analysisKey);
    if (!analysis || analysis.phase !== "background") continue;
    const result = await runAnalysis(db, ctx, analysis, input, timeoutMs);
    ran += 1;
    if (result.status === "failed") failed += 1;
  }
  const location = await db((tx) =>
    tx.gbLocation.findFirst({
      where: { id: locationId },
      select: { name: true },
    }),
  );
  return { ran, failed, name: location?.name ?? "" };
}
