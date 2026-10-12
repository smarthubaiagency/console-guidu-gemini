import "server-only";

import { recordAudit } from "@/core/audit/record";
import {
  enqueuePlatformJob,
  latestPlatformRun,
  type PlatformRunView,
} from "@/core/jobs/service";
import {
  adminAuditContext,
  requirePlatformPermission,
} from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { SOURCE_LOCALE } from "../locales";
import type { LanguageActor } from "../service";
import { machineTranslationProvider } from "./provider";
import { TRANSLATE_TEXTS_KIND, translateTextsJob } from "./texts-job";

/**
 * Web side of the machine translation of the dashboard texts (I6):
 * Plataforma › Configurações › Idiomas › <idioma> › "Traduzir
 * automaticamente". The request only queues a run; the worker translates.
 */

export function notConfigured(): AppError {
  return new AppError({
    code: "unavailable",
    safeMessage: "Provedor de tradução não configurado.",
    messageKey: "languages.auto.notConfigured",
  });
}

/** Queues the translation of the missing texts of a language. */
export async function requestTextsTranslation(
  tx: ContextTransaction,
  actor: LanguageActor,
  code: string,
): Promise<{ id: string }> {
  requirePlatformPermission(
    actor.platformRole,
    Permissions.PLATFORM_LANGUAGES_MANAGE,
  );
  const provider = machineTranslationProvider();
  if (!provider) throw notConfigured();
  if (code === SOURCE_LOCALE) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "O idioma de origem não é traduzido.",
      messageKey: "languages.auto.sourceLocale",
    });
  }
  if (!(await tx.platformLanguage.findUnique({ where: { code } }))) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Idioma não encontrado.",
    });
  }
  const run = await enqueuePlatformJob(
    tx,
    actor.userId,
    translateTextsJob,
    { locale: code, requestedBy: actor.userId },
    { subjectField: "locale" },
  );
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "platform.translation.machine_request",
    resourceType: "platform_language",
    resourceId: code,
    result: "success",
    origin: "admin",
    metadata: { target: code, provider },
  });
  return run;
}

/** Latest machine translation run of a language (status on the page). */
export async function latestTextsRun(
  tx: ContextTransaction,
  actor: LanguageActor,
  code: string,
): Promise<PlatformRunView | null> {
  requirePlatformPermission(
    actor.platformRole,
    Permissions.PLATFORM_LANGUAGES_MANAGE,
  );
  return latestPlatformRun(tx, TRANSLATE_TEXTS_KIND, "locale", code);
}
