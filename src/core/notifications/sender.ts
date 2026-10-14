import { resolveSettings, type SettingRow } from "@/core/settings/resolve";
import type { SqlExecutor } from "@/core/i18n/messages-loader";

import type { EmailSender, NotificationBrand } from "./types";

/**
 * Sender of a partner's e-mails (CF3a): `email.from_name` and
 * `email.reply_to` of the platform and of that partner, read through
 * `private.email_settings` by the dashboard and the worker alike. With no
 * partner, only the platform's values.
 */
export async function emailSender(
  db: SqlExecutor,
  partnerId: string | null,
): Promise<EmailSender> {
  const rows = await db.$queryRaw<SettingRow[]>`
    select scope, key, value, locked
    from private.email_settings(${partnerId}::uuid)
  `;
  const { values } = resolveSettings(rows);
  return {
    fromName: values["email.from_name"],
    replyTo: values["email.reply_to"],
  };
}

/** The brand with its partner's sender. */
export async function withSender(
  db: SqlExecutor,
  partnerId: string | null,
  brand: NotificationBrand,
): Promise<NotificationBrand> {
  return { ...brand, sender: await emailSender(db, partnerId) };
}
