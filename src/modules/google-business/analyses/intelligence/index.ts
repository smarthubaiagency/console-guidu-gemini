import type { LocationAnalysis } from "../contract";
import { aiSuggestionsAnalysis } from "./ai-suggestions";
import {
  mapsCompetitorsAnalysis,
  mapsGeoGridAnalysis,
  mapsKeywordsAnalysis,
} from "./maps-health";

/** AI suggestions and maps intelligence (GB1b). */
export const intelligenceAnalyses: readonly LocationAnalysis[] = [
  aiSuggestionsAnalysis,
  mapsKeywordsAnalysis,
  mapsCompetitorsAnalysis,
  mapsGeoGridAnalysis,
];
