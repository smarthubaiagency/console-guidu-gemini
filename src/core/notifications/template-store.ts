import type { SqlExecutor } from "@/core/i18n/messages-loader";

import type { EmailTemplateContent } from "./template-catalog";

export type StoredEmailTemplate = EmailTemplateContent &
  Readonly<{ scope: "platform" | "partner" }>;

/**
 * Edited template of an event in a language (CF3b), read through
 * `private.email_template`, which the dashboard (app_runtime) and the
 * worker (app_worker) may call: the partner's when it saved one, else the
 * platform's, else null (the code's template applies). With no partner,
 * only the platform's.
 */
export async function emailTemplateFor(
  db: SqlExecutor,
  partnerId: string | null,
  eventType: string,
  locale: string,
): Promise<StoredEmailTemplate | null> {
  const rows = await db.$queryRaw<
    { scope: "platform" | "partner"; subject: string; body: string }[]
  >`
    select scope, subject, body
    from private.email_template(${partnerId}::uuid, ${eventType}, ${locale})
  `;
  const row = rows[0];
  return row
    ? { scope: row.scope, subject: row.subject, body: row.body }
    : null;
}
