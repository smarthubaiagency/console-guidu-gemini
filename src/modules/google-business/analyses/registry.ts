import type { LocationAnalysis } from "./contract";
import { deterministicAnalyses } from "./deterministic";
import { intelligenceAnalyses } from "./intelligence";

/** Every analysis of a location, run by the onboarding (contract file). */
export const locationAnalyses: readonly LocationAnalysis[] = [
  ...deterministicAnalyses,
  ...intelligenceAnalyses,
];
