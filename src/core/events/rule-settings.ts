import { resolveSettings, type SettingRow } from "@/core/settings/resolve";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import type { QuietHours, Rules } from "./rules";

/**
 * The notification settings that apply to one event (H2): the rules, the
 * quiet window, the digest time and the time zone, from the rows of the
 * platform, of the event's partner and of the event's workspace
 * (`private.event_settings`, worker). Pure resolution by the cascade.
 */

export type NotificationSettings = Readonly<{
  rules: Rules;
  quiet: QuietHours;
  digestTime: string;
  timeZone: string;
}>;

export function notificationSettingsOf(
  rows: readonly SettingRow[],
): NotificationSettings {
  const { values } = resolveSettings(rows);
  return {
    rules: values["notifications.rules"],
    quiet: values["notifications.quiet_hours"],
    digestTime: values["notifications.digest_time"],
    timeZone: values["region.timezone"],
  };
}

export async function eventNotificationSettings(
  tx: ContextTransaction,
  eventId: string,
): Promise<NotificationSettings> {
  const rows = await tx.$queryRaw<SettingRow[]>`
    select scope, key, value, locked from private.event_settings(${eventId}::uuid)
  `;
  return notificationSettingsOf(rows);
}
