import type { LocationAnalysis } from "../contract";
import { hoursChecklistAnalysis } from "./hours";
import { infoChecklistAnalysis } from "./info";
import { photosChecklistAnalysis } from "./photos";
import { reviewsSummaryAnalysis } from "./reviews";

/** Deterministic analyses (GB1a): no AI, no external data. */
export const deterministicAnalyses: readonly LocationAnalysis[] = [
  infoChecklistAnalysis,
  hoursChecklistAnalysis,
  photosChecklistAnalysis,
  reviewsSummaryAnalysis,
];
