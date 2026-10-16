import "server-only";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import type { LocationSnapshot, ReviewSummary } from "../analyses/contract";
import { gbNotFound } from "./errors";
import type { AnalysisInput } from "./runner";

/** The latest version of the ficha and the reviews read with it. */
export async function initialSnapshot(
  tx: ContextTransaction,
  locationId: string,
): Promise<{ snapshot: LocationSnapshot; reviews: ReviewSummary[] }> {
  const row = await tx.gbSnapshot.findFirst({
    where: { gbLocationId: locationId },
    orderBy: { createdAt: "desc" },
    select: { data: true, reviews: true },
  });
  if (!row) throw gbNotFound();
  return {
    snapshot: row.data as unknown as LocationSnapshot,
    reviews: (row.reviews ?? []) as unknown as ReviewSummary[],
  };
}

/** What an analysis needs: a ficha already linked to its unit. */
export async function locationForRun(
  tx: ContextTransaction,
  ctx: RequestContext,
  locationId: string,
): Promise<AnalysisInput> {
  const location = await tx.gbLocation.findFirst({
    where: { id: locationId, workspaceId: ctx.workspaceId },
    select: { id: true, unitId: true },
  });
  if (!location?.unitId) throw gbNotFound();
  const { snapshot, reviews } = await initialSnapshot(tx, locationId);
  return { locationId, unitId: location.unitId, snapshot, reviews };
}
