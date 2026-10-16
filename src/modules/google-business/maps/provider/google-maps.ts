import { z } from "zod";

import type { LatLng } from "../geo";
import type { PlaceLocator } from "./types";

/**
 * Google Maps Platform (Places API, Place Details) used only for the centre
 * of the grid when neither the profile nor the unit has coordinates
 * (GB1b, especificação §6.2 and §11). Terms of the platform: only the
 * `place_id` may be kept indefinitely and coordinates at most 30 days, so
 * the answer is used in the request and never stored (the measurements keep
 * grid size and radius, not coordinates). The key comes from
 * `GOOGLE_MAPS_API_KEY`; it never reaches a log or an error.
 */

export const PLACES_BASE_URL = "https://places.googleapis.com/v1";

const Answer = z.object({
  location: z
    .object({ latitude: z.number(), longitude: z.number() })
    .optional(),
});

export function createGoogleMapsLocator(
  options: Readonly<{ apiKey: string; fetch?: typeof fetch; baseUrl?: string }>,
): PlaceLocator {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? PLACES_BASE_URL;
  return {
    async locate(placeId: string): Promise<LatLng | null> {
      if (!/^[A-Za-z0-9_-]{3,300}$/.test(placeId)) return null;
      try {
        const response = await doFetch(
          `${baseUrl}/places/${encodeURIComponent(placeId)}`,
          {
            headers: {
              "X-Goog-Api-Key": options.apiKey,
              // Field mask: only the location (cheapest SKU of the call).
              "X-Goog-FieldMask": "location",
            },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!response.ok) return null;
        const parsed = Answer.safeParse(await response.json());
        return parsed.success && parsed.data.location
          ? parsed.data.location
          : null;
      } catch {
        return null;
      }
    },
  };
}
