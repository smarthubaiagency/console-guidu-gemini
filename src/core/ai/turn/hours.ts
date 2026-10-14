import { type AgentConfig, WEEKDAYS } from "../config/schema";
import { renderAvailability } from "../prompt/render";
import { format, type PromptTexts } from "../prompt/texts";

/**
 * The agent's business hours at the time of a turn (A6c): the turn tells
 * the model whether the business is open now, and the "auto reply only"
 * rule answers after hours without the model.
 *
 * Times are compared as local "YYYY-MM-DD HH:MM" text in the agent's time
 * zone; slots never cross midnight (the schema keeps start < end).
 */

type Weekday = (typeof WEEKDAYS)[number];
type Slots = AgentConfig["scope"]["availability_slots"];

export type LocalTime = Readonly<{
  date: string;
  weekday: Weekday;
  time: string;
}>;

export function localTime(at: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: String(parts.weekday).toLowerCase().slice(0, 3) as Weekday,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** "YYYY-MM-DD HH:MM" in the time zone, to compare with `closedSince`. */
export function localStamp(at: Date, timeZone: string): string {
  const local = localTime(at, timeZone);
  return `${local.date} ${local.time}`;
}

function daysBefore(date: string, days: number): LocalTime {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d! - days));
  return {
    date: day.toISOString().slice(0, 10),
    weekday: WEEKDAYS[(day.getUTCDay() + 6) % 7]!,
    time: "24:00",
  };
}

export type BusinessHours = Readonly<{
  /** False: no hours were given, the business counts as always open. */
  configured: boolean;
  open: boolean;
  /** When it last closed (local stamp); null while open. */
  closedSince: string | null;
}>;

export function businessHours(
  slots: Slots,
  now: Date,
  timeZone: string,
): BusinessHours {
  if (!slots || slots.length === 0) {
    return { configured: false, open: true, closedSince: null };
  }
  const today = localTime(now, timeZone);
  const open = slots.some(
    (s) =>
      s.weekday === today.weekday &&
      s.start <= today.time &&
      today.time < s.end,
  );
  if (open) return { configured: true, open, closedSince: null };
  // The latest end of a slot before now, a week back at most.
  for (let back = 0; back <= 7; back += 1) {
    const day = back === 0 ? today : daysBefore(today.date, back);
    const ends = slots
      .filter((s) => s.weekday === day.weekday && s.end <= day.time)
      .map((s) => s.end)
      .sort();
    const last = ends.at(-1);
    if (last)
      return { configured: true, open, closedSince: `${day.date} ${last}` };
  }
  return { configured: true, open, closedSince: null };
}

/**
 * The lines the turn adds to the instructions: the local time and, when
 * hours were given, whether the business is open, with the after-hours
 * rule when it is closed.
 */
export function hoursInstruction(
  config: AgentConfig,
  hours: BusinessHours,
  now: Date,
  timeZone: string,
  dateLocale: string,
  texts: PromptTexts,
): string {
  const local = localTime(now, timeZone);
  const weekday = new Intl.DateTimeFormat(dateLocale, {
    timeZone,
    weekday: "long",
  }).format(now);
  const lines = [
    format(texts.hoursNow.now, {
      weekday,
      date: local.date,
      time: local.time,
      timezone: timeZone,
    }),
  ];
  if (hours.configured) {
    const schedule = renderAvailability(config.scope.availability_slots, texts);
    lines.push(
      format(hours.open ? texts.hoursNow.open : texts.hoursNow.closed, {
        hours: schedule,
      }),
    );
    const rule = config.rules.after_hours_behavior;
    if (!hours.open && rule) {
      lines.push(texts.afterHoursBehavior[rule] ?? rule);
    }
  }
  return lines.join("\n");
}

/** The automatic answer after hours ("auto reply only"). */
export function afterHoursReply(
  config: AgentConfig,
  texts: PromptTexts,
): string {
  return format(texts.hoursNow.autoReply, {
    hours: renderAvailability(config.scope.availability_slots, texts),
  });
}
