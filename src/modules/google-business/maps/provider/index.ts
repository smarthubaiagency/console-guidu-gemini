import { createDataForSeoProvider } from "./dataforseo";
import { createFakeMapsProvider } from "./fake";
import { createGoogleMapsLocator } from "./google-maps";
import type {
  MapsIntelligenceProvider,
  MapsProviderId,
  PlaceLocator,
} from "./types";

/**
 * Which maps provider this process uses (GB1b), from its environment:
 *
 * - `MAPS_INTELLIGENCE_PROVIDER=fake`: the deterministic fake (tests, e2e);
 *   production refuses it at startup (src/core/config/env.ts).
 * - `MAPS_INTELLIGENCE_PROVIDER=dataforseo`, or unset with both
 *   `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`: DataForSEO.
 * - otherwise none: the maps analyses are skipped with a clear reason.
 *
 * `GOOGLE_MAPS_API_KEY` optionally adds the Places locator for the centre.
 */

type Env = Readonly<Record<string, string | undefined>>;

export function mapsProviderId(env: Env = process.env): MapsProviderId | null {
  const chosen = env.MAPS_INTELLIGENCE_PROVIDER?.trim();
  if (chosen === "fake") return "fake";
  const hasCredentials = Boolean(
    env.DATAFORSEO_LOGIN?.trim() && env.DATAFORSEO_PASSWORD?.trim(),
  );
  if ((chosen === "dataforseo" || !chosen) && hasCredentials) {
    return "dataforseo";
  }
  return null;
}

export function getMapsProvider(
  env: Env = process.env,
): MapsIntelligenceProvider | null {
  switch (mapsProviderId(env)) {
    case "fake":
      return createFakeMapsProvider();
    case "dataforseo":
      return createDataForSeoProvider({
        login: env.DATAFORSEO_LOGIN!.trim(),
        password: env.DATAFORSEO_PASSWORD!.trim(),
      });
    default:
      return null;
  }
}

export function getPlaceLocator(env: Env = process.env): PlaceLocator | null {
  if (env.MAPS_INTELLIGENCE_PROVIDER?.trim() === "fake") return null;
  const apiKey = env.GOOGLE_MAPS_API_KEY?.trim();
  return apiKey ? createGoogleMapsLocator({ apiKey }) : null;
}

export type { MapsIntelligenceProvider, PlaceLocator } from "./types";
