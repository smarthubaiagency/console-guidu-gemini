import { SOURCE_LOCALE, type Messages } from "@/core/i18n/locales";
import { loadMessagesFor, type SqlExecutor } from "@/core/i18n/messages-loader";

import type { NotificationLanguage } from "./notify";

/**
 * Language of a recipient (I5, ADR 0013): the language of the person with
 * that e-mail when it is active, else the platform default. Read through
 * `private.notification_locale`, which the worker (app_worker) and the
 * dashboard (app_runtime) may call; it answers only a language code.
 */
export async function notificationLocale(
  db: SqlExecutor,
  email: string,
): Promise<string> {
  const rows = await db.$queryRaw<{ locale: string | null }[]>`
    select private.notification_locale(${email}) as locale
  `;
  return rows[0]?.locale ?? SOURCE_LOCALE;
}

/**
 * Resolves recipients' languages with their texts (files plus the edits of
 * Plataforma › Idiomas), reading each language's texts once per instance.
 */
export function notificationLanguages(db: SqlExecutor) {
  const texts = new Map<string, Promise<Messages>>();
  return async function languageOf(
    email: string,
  ): Promise<NotificationLanguage> {
    const locale = await notificationLocale(db, email);
    let messages = texts.get(locale);
    if (!messages) {
      messages = loadMessagesFor(db, locale);
      texts.set(locale, messages);
    }
    return { locale, messages: await messages };
  };
}
