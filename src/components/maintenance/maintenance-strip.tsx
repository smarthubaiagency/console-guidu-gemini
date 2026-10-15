import { CalendarClock, Construction, Lock } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { maintenanceStatus } from "@/core/maintenance/runtime";
import {
  MAINTENANCE_TIME_ZONE,
  maintenanceMessage,
  type MaintenanceStatus,
} from "@/core/maintenance/state";

/**
 * Notice strip of the maintenance window (CF5c), on top of the content of
 * every shell (/app, /admin, /platform) and of the login page:
 *
 * - up to 24 hours before a scheduled start: "Manutenção programada para
 *   hoje às 23:00", for everybody;
 * - during read-only: writes are suspended (the refusals themselves go to
 *   the SmartStatusBanner);
 * - during full maintenance: only /platform and the login stay open, so it
 *   tells who is there that the workspaces and /admin are closed.
 *
 * The admin's message in the person's language follows the sentence.
 */

const dayKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: MAINTENANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export async function MaintenanceStrip({
  status: given,
  now = new Date(),
}: Readonly<{ status?: MaintenanceStatus; now?: Date }>) {
  const status = given ?? (await maintenanceStatus());
  if (status.phase === "off") return null;
  if (status.phase === "scheduled" && !status.notice) return null;

  const t = await getTranslations("maintenance.strip");
  const format = await getFormatter();
  const locale = await getLocale();
  const time = (date: Date) =>
    format.dateTime(date, {
      timeStyle: "short",
      timeZone: MAINTENANCE_TIME_ZONE,
    });
  const when = (date: Date): string => {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (dayKey(date) === dayKey(now)) return t("today", { time: time(date) });
    if (dayKey(date) === dayKey(tomorrow)) {
      return t("tomorrow", { time: time(date) });
    }
    return format.dateTime(date, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: MAINTENANCE_TIME_ZONE,
    });
  };

  const { window: current } = status;
  let sentence: string;
  let Icon = CalendarClock;
  if (status.phase === "scheduled") {
    const start = when(current.startsAt ?? now);
    sentence = current.endsAt
      ? t(`scheduledWithEnd.${current.mode}`, {
          start,
          end: when(current.endsAt),
        })
      : t(`scheduled.${current.mode}`, { start });
  } else if (current.mode === "read_only") {
    Icon = Lock;
    sentence = current.endsAt
      ? t("readOnlyUntil", { end: when(current.endsAt) })
      : t("readOnly");
  } else {
    Icon = Construction;
    sentence = current.endsAt
      ? t("maintenanceUntil", { end: when(current.endsAt) })
      : t("maintenance");
  }
  const message = maintenanceMessage(current.messages, locale);

  return (
    <div
      role="status"
      data-testid="maintenance-strip"
      data-phase={status.phase}
      data-mode={current.mode}
      className="border-warning-border bg-warning-bg text-warning-text text-12 flex shrink-0 items-start gap-2 border-b px-4 py-2"
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">{sentence}</span>
        {message ? <span> {message}</span> : null}
      </p>
    </div>
  );
}
