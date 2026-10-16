import type { LocationAnalysis, LocationSnapshot } from "../contract";
import { checklistResult, type ChecklistItem } from "./checklist";
import { daysBetween, upcomingHolidays } from "./holidays";

/** Look-ahead of the holidays (especificação §8.5: 45 days). */
export const HOLIDAY_LOOKAHEAD_DAYS = 45;
/** A holiday this close without special hours is urgent (§5: 14 days). */
export const HOLIDAY_URGENT_DAYS = 14;

export function hoursChecklist(snapshot: LocationSnapshot): ChecklistItem[] {
  const today = snapshot.readAt.slice(0, 10);
  const covered = new Set(snapshot.specialHours.map((h) => h.date));
  const missing = upcomingHolidays(today, HOLIDAY_LOOKAHEAD_DAYS).filter(
    (holiday) => !covered.has(holiday.date),
  );
  const next = missing[0];
  const inDays = next ? daysBetween(today, next.date) : null;
  return [
    {
      key: "regular-hours-missing",
      ok: snapshot.regularHours.length > 0,
      severity: "high",
    },
    {
      key: "holidays-missing",
      ok: missing.length === 0,
      severity:
        inDays !== null && inDays <= HOLIDAY_URGENT_DAYS ? "high" : "medium",
      ...(next
        ? {
            values: {
              count: missing.length,
              date: next.date,
              days: inDays ?? 0,
            },
          }
        : {}),
    },
  ];
}

/** Regular hours and the national holidays of the next 45 days. */
export const hoursChecklistAnalysis: LocationAnalysis = {
  key: "hours-checklist",
  area: "hours",
  phase: "blocking",
  labelKey: "googleBusiness.analyses.hours-checklist",
  usesAi: false,
  async run({ snapshot }) {
    const today = snapshot.readAt.slice(0, 10);
    return checklistResult("hours", hoursChecklist(snapshot), {
      upcomingHolidays: upcomingHolidays(today, HOLIDAY_LOOKAHEAD_DAYS).length,
    });
  },
};
