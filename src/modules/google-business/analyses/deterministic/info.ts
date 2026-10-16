import type { LocationAnalysis, LocationSnapshot } from "../contract";
import { checklistResult, type ChecklistItem } from "./checklist";

/** Google allows 750 characters; under 250 says little about the business. */
export const DESCRIPTION_MIN_LENGTH = 250;

const LINK = /(https?:\/\/|www\.)\S+/i;

/** Attributes of the ficha, without our own markers (`_...`). */
export function realAttributes(snapshot: LocationSnapshot): string[] {
  return Object.keys(snapshot.attributes).filter((key) => !key.startsWith("_"));
}

export function infoChecklist(snapshot: LocationSnapshot): ChecklistItem[] {
  const description = snapshot.description?.trim() ?? "";
  return [
    {
      key: "primary-category",
      ok: Boolean(snapshot.primaryCategory),
      severity: "critical",
    },
    {
      key: "additional-categories",
      ok: snapshot.additionalCategories.length > 0,
      severity: "low",
      current: snapshot.primaryCategory,
    },
    {
      key: "description-missing",
      ok: description.length > 0,
      severity: "high",
    },
    {
      key: "description-short",
      ok:
        description.length === 0
          ? null
          : description.length >= DESCRIPTION_MIN_LENGTH,
      severity: "medium",
      values: { length: description.length, min: DESCRIPTION_MIN_LENGTH },
      current: description || null,
    },
    {
      key: "description-link",
      ok: description.length === 0 ? null : !LINK.test(description),
      severity: "medium",
    },
    { key: "phone-missing", ok: Boolean(snapshot.phone), severity: "high" },
    {
      key: "website-missing",
      ok: Boolean(snapshot.website),
      severity: "medium",
    },
    {
      key: "attributes-missing",
      ok: realAttributes(snapshot).length > 0,
      severity: "low",
    },
  ];
}

/** Information of the ficha (categories, description, contact, attributes). */
export const infoChecklistAnalysis: LocationAnalysis = {
  key: "info-checklist",
  area: "info",
  phase: "blocking",
  labelKey: "googleBusiness.analyses.info-checklist",
  usesAi: false,
  async run({ snapshot }) {
    return checklistResult("info", infoChecklist(snapshot));
  },
};
