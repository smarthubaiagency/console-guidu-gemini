import type { LocationAnalysis, LocationSnapshot } from "../contract";
import { checklistResult, type ChecklistItem } from "./checklist";

/** Below this the ficha looks empty next to the competitors. */
export const PHOTOS_MIN = 10;

/** Our markers in `attributes` (set by the providers that know them). */
export const MEDIA_LOGO = "_media.logo";
export const MEDIA_COVER = "_media.cover";
export const MEDIA_PHOTOS_UNKNOWN = "_media.photos_unknown";

function known(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function photosChecklist(snapshot: LocationSnapshot): ChecklistItem[] {
  const photosUnknown = snapshot.attributes[MEDIA_PHOTOS_UNKNOWN] === true;
  return [
    {
      key: "photos-few",
      ok: photosUnknown ? null : snapshot.photoCount >= PHOTOS_MIN,
      severity: "medium",
      values: { count: snapshot.photoCount, min: PHOTOS_MIN },
    },
    {
      key: "logo-missing",
      ok: known(snapshot.attributes[MEDIA_LOGO]),
      severity: "medium",
    },
    {
      key: "cover-missing",
      ok: known(snapshot.attributes[MEDIA_COVER]),
      severity: "low",
    },
  ];
}

/** Photos, logo and cover (only what the provider reports). */
export const photosChecklistAnalysis: LocationAnalysis = {
  key: "photos-checklist",
  area: "photos",
  phase: "blocking",
  labelKey: "googleBusiness.analyses.photos-checklist",
  usesAi: false,
  async run({ snapshot }) {
    return checklistResult("photos", photosChecklist(snapshot), {
      photos:
        snapshot.attributes[MEDIA_PHOTOS_UNKNOWN] === true
          ? null
          : snapshot.photoCount,
    });
  },
};
