import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { readSessionClaims } from "@/core/auth/identity";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { appLog } from "@/lib/telemetry/log";
import { MESSAGE_FILES } from "@/i18n/messages";

import {
  type BuiltInLocale,
  chooseLocale,
  isBuiltInLocale,
  mergeMessages,
  type Messages,
  negotiateLocale,
  SOURCE_LOCALE,
} from "./locales";
import { PATH_HEADER, workspaceSlugOf } from "./path";

/**
 * Languages and texts of each request (I1). The language comes from the
 * person, then the workspace in the path, then the platform default; the
 * browser counts only for visitors without a session. Texts are the code's files plus the edits made in
 * Plataforma › Configurações › Idiomas, read through SECURITY DEFINER
 * functions (every page, logged in or not) and kept for a short time in
 * memory; saving in that screen clears this process at once.
 */

const FILES: Record<BuiltInLocale, Messages> = MESSAGE_FILES;

export const SOURCE_MESSAGES: Messages = FILES["pt-BR"];

export function fileMessages(locale: string): Messages | null {
  return isBuiltInLocale(locale) ? FILES[locale] : null;
}

const TTL_MS = 30_000;
type Entry<T> = { value: T; at: number };
type I18nCache = {
  languages: Entry<UiLanguage[]> | null;
  edits: Map<string, Entry<Record<string, string>>>;
};

// One cache per process: the dev server may load this module once per route
// bundle, and an edit must clear the texts every page reads.
const globalCache = globalThis as typeof globalThis & {
  __guiduI18nCache?: I18nCache;
};
const cacheStore: I18nCache = (globalCache.__guiduI18nCache ??= {
  languages: null,
  edits: new Map(),
});

export type UiLanguage = Readonly<{
  code: string;
  name: string;
  isDefault: boolean;
}>;

const FALLBACK_LANGUAGES: UiLanguage[] = [
  { code: "pt-BR", name: "Português (Brasil)", isDefault: true },
  { code: "en", name: "English", isDefault: false },
  { code: "es", name: "Español", isDefault: false },
];

/** Clears the cached languages and texts (after an edit). */
export function invalidateI18nCache(): void {
  cacheStore.languages = null;
  cacheStore.edits.clear();
}

const fresh = <T>(entry: Entry<T> | null | undefined): entry is Entry<T> =>
  Boolean(entry && Date.now() - entry.at < TTL_MS);

/** Active languages, in display order. */
export async function activeLanguages(): Promise<UiLanguage[]> {
  if (fresh(cacheStore.languages)) return cacheStore.languages.value;
  try {
    const rows = await prisma.$queryRaw<
      { code: string; name: string; is_default: boolean }[]
    >`select code, name, is_default from private.ui_languages()`;
    const value = rows.map((r) => ({
      code: r.code,
      name: r.name,
      isDefault: r.is_default,
    }));
    cacheStore.languages = { value, at: Date.now() };
    return value;
  } catch (error) {
    appLog.error("i18n.languages_failed", { error });
    return FALLBACK_LANGUAGES;
  }
}

async function translationEdits(
  locale: string,
): Promise<Record<string, string>> {
  const cached = cacheStore.edits.get(locale);
  if (fresh(cached)) return cached.value;
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      select key, value from private.ui_translations(${locale})
    `;
    const value = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cacheStore.edits.set(locale, { value, at: Date.now() });
    return value;
  } catch (error) {
    appLog.error("i18n.translations_failed", { locale, error });
    return {};
  }
}

/** Texts of a language: source, the language's file, platform edits. */
export async function loadMessages(locale: string): Promise<Messages> {
  return mergeMessages(
    SOURCE_MESSAGES,
    fileMessages(locale),
    await translationEdits(locale),
  );
}

async function userLocale(userId: string): Promise<string | null> {
  const profile = await withIdentityContext(prisma, userId, (tx) =>
    tx.profile.findUnique({ where: { id: userId }, select: { locale: true } }),
  );
  return profile?.locale ?? null;
}

async function workspaceLocale(
  userId: string,
  slug: string,
): Promise<string | null> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`select set_config('app.user_id', ${userId}, true)`,
    prisma.$queryRaw<{ locale: string | null }[]>`
      select private.ui_workspace_locale(${slug}) as locale
    `,
  ]);
  return rows[0]?.locale ?? null;
}

/** Language of the current request, resolved once per request. */
export const resolveRequestLocale = cache(async (): Promise<string> => {
  const languages = await activeLanguages();
  const active = languages.map((l) => l.code);
  const platformDefault =
    languages.find((l) => l.isDefault)?.code ?? SOURCE_LOCALE;
  const h = await headers();
  let user: string | null = null;
  let workspace: string | null = null;
  let signedIn = false;
  try {
    const claims = await readSessionClaims();
    if (claims?.sub) {
      signedIn = true;
      user = await userLocale(claims.sub);
      const slug = workspaceSlugOf(h.get(PATH_HEADER));
      if (!user && slug) workspace = await workspaceLocale(claims.sub, slug);
    }
  } catch (error) {
    appLog.error("i18n.locale_failed", { error });
  }
  return chooseLocale(
    {
      user,
      workspace,
      // The browser decides only for visitors without a session; members
      // follow their own choice, the workspace's or the platform's.
      browser: signedIn
        ? null
        : negotiateLocale(h.get("accept-language"), active),
      platformDefault,
    },
    active,
  );
});
