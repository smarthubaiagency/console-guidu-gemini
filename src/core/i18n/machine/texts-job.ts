import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { definePlatformJob } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { flattenMessages, LOCALE_CODE, SOURCE_LOCALE } from "../locales";
import { fileMessages, SOURCE_MESSAGES } from "../messages-loader";
import { getMachineTranslator } from "./provider";
import {
  type LanguageRef,
  type MachineTranslator,
  TranslationIncompleteError,
} from "./types";
import {
  acceptMachineText,
  chunk,
  mapLimited,
  MAX_KEYS_PER_RUN,
  TEXTS_PER_CALL,
} from "./validate";

/**
 * Job `i18n.translate-texts` (I6): fills, with origin `machine`, the texts
 * of a language that have neither a platform edit nor a text shipped in the
 * code. Runs as app_worker (platform job): it reads the language and the
 * keys already edited, calls the translator chunk by chunk and inserts only
 * new rows (`on conflict do nothing`), so a manual or earlier machine text
 * is never overwritten, not even one saved while the job ran. Every output
 * passes the checks of a manual edit; a failing one is skipped and counted.
 *
 * The dashboard caches the texts for 30 s per process (`store.ts`); the
 * worker does not clear it, so new texts show up within that time.
 */

export const TRANSLATE_TEXTS_KIND = "i18n.translate-texts";

export const TranslateTextsPayload = z
  .object({
    locale: z.string().regex(LOCALE_CODE),
    requestedBy: z.string().uuid(),
  })
  .strict();
export type TranslateTextsPayload = z.infer<typeof TranslateTextsPayload>;

/** Provider calls at the same time within one run. */
const PARALLEL_CALLS = 3;

/** Audit of the platform jobs: a service of the worker, never a user. */
export const WORKER_AUDIT_CONTEXT: RequestContext = {
  userId: "",
  workspaceId: "",
  organizationId: "",
  principalType: "service",
};

export async function requireTranslator(): Promise<MachineTranslator> {
  const translator = await getMachineTranslator();
  if (!translator) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Provedor de tradução não configurado no worker.",
    });
  }
  return translator;
}

export type TranslateTextsResult = {
  locale: string;
  provider: string;
  missing: number;
  translated: number;
  invalid: number;
  skipped: number;
  remaining: number;
};

export async function translateMissingTexts(
  tx: ContextTransaction,
  payload: TranslateTextsPayload,
  translator: MachineTranslator,
): Promise<TranslateTextsResult> {
  const { locale } = payload;
  const languages = await tx.platformLanguage.findMany({
    where: { code: { in: [locale, SOURCE_LOCALE] } },
    select: { code: true, name: true },
  });
  const target = languages.find((l) => l.code === locale);
  if (!target) throw new SkipJobError("Idioma não encontrado.");
  const source: LanguageRef = languages.find(
    (l) => l.code === SOURCE_LOCALE,
  ) ?? { code: SOURCE_LOCALE, name: "Português (Brasil)" };

  const result: TranslateTextsResult = {
    locale,
    provider: translator.provider,
    missing: 0,
    translated: 0,
    invalid: 0,
    skipped: 0,
    remaining: 0,
  };
  if (locale !== SOURCE_LOCALE) {
    const sourceTexts = flattenMessages(SOURCE_MESSAGES);
    const shipped = fileMessages(locale);
    const shippedTexts = shipped ? flattenMessages(shipped) : {};
    const edited = new Set(
      (
        await tx.platformTranslation.findMany({
          where: { locale },
          select: { key: true },
        })
      ).map((row) => row.key),
    );
    const missing = Object.entries(sourceTexts)
      .filter(([key]) => !edited.has(key) && shippedTexts[key] === undefined)
      .map(([key, text]) => ({ key, text }));
    const todo = missing.slice(0, MAX_KEYS_PER_RUN);
    result.missing = missing.length;
    result.remaining = missing.length - todo.length;

    const answers = await mapLimited(
      chunk(todo, TEXTS_PER_CALL),
      PARALLEL_CALLS,
      async (entries) => {
        try {
          return await translator.translateTexts(source, target, entries);
        } catch (error) {
          // A declined or cut chunk is skipped; the rest of the run goes on.
          if (error instanceof TranslationIncompleteError) return {};
          throw error;
        }
      },
    );
    const keys: string[] = [];
    const values: string[] = [];
    const translated: Record<string, string> = Object.assign({}, ...answers);
    for (const { key, text } of todo) {
      if (!(key in translated)) {
        result.skipped += 1;
        continue;
      }
      const accepted = acceptMachineText(text, translated[key]);
      if (accepted === null) {
        result.invalid += 1;
        continue;
      }
      keys.push(key);
      values.push(accepted);
    }
    if (keys.length > 0) {
      // Only new rows: an existing text (manual or machine) always wins.
      result.translated = await tx.$executeRaw`
        insert into public.platform_translations (locale, key, value, origin)
        select ${locale}, t.key, t.value, 'machine'
        from unnest(${keys}::text[], ${values}::text[]) as t(key, value)
        on conflict do nothing
      `;
    }
  }

  await recordAudit(tx, WORKER_AUDIT_CONTEXT, {
    action: "platform.translation.machine",
    resourceType: "platform_language",
    resourceId: locale,
    result: "success",
    origin: "worker",
    metadata: {
      target: locale,
      provider: result.provider,
      status: "succeeded",
      translated: result.translated,
      invalid: result.invalid,
      skipped: result.skipped,
      remaining: result.remaining,
    },
  });
  return result;
}

export const translateTextsJob = definePlatformJob<TranslateTextsPayload>({
  kind: TRANSLATE_TEXTS_KIND,
  description:
    "Tradução automática dos textos que faltam em um idioma do painel (I6).",
  payload: TranslateTextsPayload,
  maxAttempts: 3,
  retryDelaySeconds: 60,
  // About 14 provider calls for a new language, three at a time.
  expireInSeconds: 1800,
  run: async (tx, payload) =>
    translateMissingTexts(tx, payload, await requireTranslator()),
});
