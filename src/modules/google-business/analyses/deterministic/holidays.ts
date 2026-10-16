/**
 * Brazilian national holidays (GB1a, especificação §5 "Horários"): fixed
 * dates plus the movable ones from Easter. State and municipal holidays come
 * later with the calendar per city. Pure; dates as ISO `YYYY-MM-DD`.
 */

export type Holiday = Readonly<{ key: string; date: string }>;

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Easter Sunday (anonymous Gregorian algorithm), UTC date. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function shift(date: Date, days: number): string {
  const d = new Date(date.getTime() + days * 86_400_000);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function nationalHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  return [
    { key: "new_year", date: iso(year, 1, 1) },
    { key: "carnival_monday", date: shift(easter, -48) },
    { key: "carnival_tuesday", date: shift(easter, -47) },
    { key: "good_friday", date: shift(easter, -2) },
    { key: "tiradentes", date: iso(year, 4, 21) },
    { key: "labour_day", date: iso(year, 5, 1) },
    { key: "corpus_christi", date: shift(easter, 60) },
    { key: "independence", date: iso(year, 9, 7) },
    { key: "aparecida", date: iso(year, 10, 12) },
    { key: "all_souls", date: iso(year, 11, 2) },
    { key: "republic", date: iso(year, 11, 15) },
    { key: "black_consciousness", date: iso(year, 11, 20) },
    { key: "christmas", date: iso(year, 12, 25) },
  ].sort((x, y) => x.date.localeCompare(y.date));
}

/** Holidays from `from` (inclusive) up to `days` ahead, in date order. */
export function upcomingHolidays(from: string, days: number): Holiday[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = shift(start, days);
  const year = start.getUTCFullYear();
  return [...nationalHolidays(year), ...nationalHolidays(year + 1)].filter(
    (h) => h.date >= from && h.date <= end,
  );
}

/** Whole days between two ISO dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}
