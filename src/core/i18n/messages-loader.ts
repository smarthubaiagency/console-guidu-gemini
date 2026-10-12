import type { Prisma } from "@prisma/client";

import { MESSAGE_FILES } from "@/i18n/messages";

import {
  type BuiltInLocale,
  isBuiltInLocale,
  mergeMessages,
  type Messages,
} from "./locales";

/**
 * Texts of a language for any process (I5): the dashboard (through
 * `store.ts`, with its cache) and the worker, which renders notifications
 * as app_worker inside a job transaction. No `server-only`, no request
 * APIs: only the shipped files and the platform edits, read through
 * `private.ui_translations` (active languages only).
 */

const FILES: Record<BuiltInLocale, Messages> = MESSAGE_FILES;

export const SOURCE_MESSAGES: Messages = FILES["pt-BR"];

export function fileMessages(locale: string): Messages | null {
  return isBuiltInLocale(locale) ? FILES[locale] : null;
}

/** Anything that runs raw queries: the Prisma client or a transaction. */
export type SqlExecutor = Readonly<{
  $queryRaw<T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ): Prisma.PrismaPromise<T>;
}>;

/** Platform edits of an active language, by flat message key. */
export async function readTranslationEdits(
  db: SqlExecutor,
  locale: string,
): Promise<Record<string, string>> {
  const rows = await db.$queryRaw<{ key: string; value: string }[]>`
    select key, value from private.ui_translations(${locale})
  `;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Source texts, then the language's file, then the given edits. */
export function composeMessages(
  locale: string,
  edits: Readonly<Record<string, string>> = {},
): Messages {
  return mergeMessages(SOURCE_MESSAGES, fileMessages(locale), edits);
}

/**
 * Texts of a language read with `db`. Errors are not swallowed: inside a
 * transaction a failed query aborts it, so the caller (a job) retries.
 */
export async function loadMessagesFor(
  db: SqlExecutor,
  locale: string,
): Promise<Messages> {
  return composeMessages(locale, await readTranslationEdits(db, locale));
}
