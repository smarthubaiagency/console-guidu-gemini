import "server-only";

import type { PrismaClient } from "@prisma/client";

import { aiPolicy, withBaseUrl } from "@/core/ai/catalog";
import { AI_PROVIDERS, modelsOf, type AiProviderId } from "@/core/ai/models";
import type { ModelFactory } from "@/core/ai/providers";
import { recordAudit } from "@/core/audit/record";
import type { ChannelFetch } from "@/core/channels/http";
import { decryptSecret, encryptSecret } from "@/core/credentials/crypto";
import type { AIProvider } from "@/core/credentials/vault";
import { type ContactLocale, contactLocaleOf } from "@/core/matrix/locale";
import {
  getWorkspaceModuleConfig,
  saveWorkspaceModuleConfig,
} from "@/core/module-runtime/settings";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import { createAiTranslator } from "@/core/translation/ai";
import { createGoogleTranslator } from "@/core/translation/google";
import { translateWithin } from "@/core/translation/run";
import {
  TranslationError,
  type TranslationEngineId,
  type TranslationErrorCode,
  type Translator,
} from "@/core/translation/types";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import {
  suggestFastModel,
  TranslationSettings,
  translationSettingsOf,
} from "../translation-settings";

/**
 * Translation of the chat in the Inbox (TR2, docs/modules/inbox/traducao.md):
 * the block "Tradução" of the settings (`inbox.manage` writes, `inbox.view`
 * reads), the Google Translate key of the vault, the test of an engine,
 * the engines of the job and the translations the window shows. Every
 * function runs inside `withContext`; the database repeats the checks.
 */

export const GOOGLE_TRANSLATE_PROVIDER = "google_translate";
const GOOGLE_LABEL = "Google Translate";

/** A pending translation older than this is shown as unavailable. */
const STALE_PENDING_MS = 3 * 60_000;
/** The notices look at the translations of the last day. */
const NOTICE_WINDOW_MS = 24 * 60 * 60_000;

export type TranslationKeyOption = Readonly<{
  id: string;
  provider: AiProviderId;
  label: string;
  maskedValue: string;
}>;

export type GoogleKeyView = Readonly<{
  id: string;
  maskedValue: string;
}>;

/** A key that fails after the translation was turned on (A2c pattern). */
export type TranslationNotice = Readonly<{
  /** Both engines failed: the team sees the originals. */
  failed: boolean;
  code: TranslationErrorCode;
  engine: TranslationEngineId | null;
  at: string;
}>;

export type TranslationSettingsView = Readonly<{
  settings: TranslationSettings;
  teamLocale: ContactLocale;
  aiKeys: readonly TranslationKeyOption[];
  /** Models of each provider; null leaves the model free. */
  models: Readonly<Partial<Record<AiProviderId, readonly string[] | null>>>;
  suggested: Readonly<Partial<Record<AiProviderId, string | null>>>;
  google: GoogleKeyView | null;
  notice: TranslationNotice | null;
}>;

function invalid(message: string, key: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `inboxGuids.translation.errors.${key}`,
  });
}

/** The team's language: the workspace's (decision of 19/10/2026). */
export async function teamLocaleOf(
  tx: ContextTransaction,
  workspaceId: string,
): Promise<ContactLocale> {
  const workspace = await tx.workspace.findFirst({
    where: { id: workspaceId },
    select: { defaultLocale: true },
  });
  return contactLocaleOf(workspace?.defaultLocale);
}

async function aiKeysOf(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<TranslationKeyOption[]> {
  const rows = await tx.credential.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: "active",
      provider: { in: [...AI_PROVIDERS] },
      purpose: { in: ["chat", "all"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, provider: true, label: true, maskedValue: true },
  });
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider as AiProviderId,
    label: row.label,
    maskedValue: row.maskedValue,
  }));
}

async function googleKeyRow(tx: ContextTransaction, ctx: RequestContext) {
  return tx.credential.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      provider: GOOGLE_TRANSLATE_PROVIDER,
      status: "active",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, maskedValue: true, encryptedPayload: true },
  });
}

/**
 * The notice of a failing engine: the latest translation of the last day
 * failed, or its main engine refused the key or the quota.
 */
export async function translationNotice(
  tx: ContextTransaction,
  ctx: RequestContext,
  settings: TranslationSettings,
  now: Date = new Date(),
): Promise<TranslationNotice | null> {
  if (!settings.enabled) return null;
  const latest = await tx.inboxMessageTranslation.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      direction: "inbound",
      status: { in: ["done", "failed"] },
      updatedAt: { gte: new Date(now.getTime() - NOTICE_WINDOW_MS) },
    },
    orderBy: { updatedAt: "desc" },
    select: { status: true, primaryError: true, updatedAt: true },
  });
  if (!latest) return null;
  const code = (latest.primaryError ?? "error") as TranslationErrorCode;
  if (latest.status === "failed") {
    return {
      failed: true,
      code,
      engine: settings.primary,
      at: latest.updatedAt.toISOString(),
    };
  }
  if (latest.primaryError === "key" || latest.primaryError === "quota") {
    return {
      failed: false,
      code,
      engine: settings.primary,
      at: latest.updatedAt.toISOString(),
    };
  }
  return null;
}

export async function loadTranslationSettingsView(
  tx: ContextTransaction,
  ctx: RequestContext,
  config: unknown,
): Promise<TranslationSettingsView> {
  const settings = translationSettingsOf(config);
  const [teamLocale, aiKeys, google, policy] = await Promise.all([
    teamLocaleOf(tx, ctx.workspaceId),
    aiKeysOf(tx, ctx),
    googleKeyRow(tx, ctx),
    aiPolicy(tx),
  ]);
  const models: Partial<Record<AiProviderId, readonly string[] | null>> = {};
  const suggested: Partial<Record<AiProviderId, string | null>> = {};
  for (const provider of AI_PROVIDERS) {
    const list = modelsOf(policy, provider);
    models[provider] = list;
    suggested[provider] = suggestFastModel(provider, list);
  }
  return {
    settings,
    teamLocale,
    aiKeys,
    models,
    suggested,
    google: google ? { id: google.id, maskedValue: google.maskedValue } : null,
    notice: await translationNotice(tx, ctx, settings),
  };
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

export type TranslatorDeps = Readonly<{
  createModel?: ModelFactory;
  googleFetch?: ChannelFetch;
  googleBaseUrl?: string;
  /** Tests and the e2e double: an engine in place of the real adapter. */
  override?: Partial<Record<TranslationEngineId, Translator>>;
}>;

/**
 * The translator of an engine with the workspace's key, or null when the
 * engine is not ready (no key, no model, a revoked key). Reads inside the
 * transaction; the call itself happens outside it.
 */
export async function resolveTranslator(
  tx: ContextTransaction,
  ctx: RequestContext,
  settings: TranslationSettings,
  engine: TranslationEngineId,
  deps: TranslatorDeps = {},
): Promise<Translator | null> {
  if (engine === "ai") {
    const { credential_id: credentialId, model } = settings.ai;
    if (!credentialId || !model) return null;
    const credential = await tx.credential.findFirst({
      where: {
        id: credentialId,
        workspaceId: ctx.workspaceId,
        status: "active",
        provider: { in: [...AI_PROVIDERS] },
        purpose: { in: ["chat", "all"] },
      },
      select: { provider: true, encryptedPayload: true },
    });
    if (!credential) return null;
    if (deps.override?.ai) return deps.override.ai;
    const key = await withBaseUrl(tx, {
      provider: credential.provider as AIProvider,
      secret: decryptSecret(credential.encryptedPayload),
      model,
    });
    return createAiTranslator(
      key,
      deps.createModel ? { createModel: deps.createModel } : {},
    );
  }
  const google = await googleKeyRow(tx, ctx);
  if (!google) return null;
  if (deps.override?.google) return deps.override.google;
  return createGoogleTranslator(decryptSecret(google.encryptedPayload), {
    ...(deps.googleFetch ? { fetch: deps.googleFetch } : {}),
    ...(deps.googleBaseUrl ? { baseUrl: deps.googleBaseUrl } : {}),
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Saves the block "Tradução" (`inbox.manage`, checked again by
 * `saveWorkspaceModuleConfig`). The switch only turns on with a main
 * engine ready; a fallback must be ready too, and differ from the main.
 */
export async function saveTranslationSettings(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<TranslationSettings> {
  await requireWorkspacePermission(tx, ctx, Permissions.INBOX_MANAGE);
  const parsed = TranslationSettings.safeParse(input);
  if (!parsed.success) {
    throw invalid("Confira os campos da tradução.", "invalid");
  }
  const settings: TranslationSettings = {
    ...parsed.data,
    fallback:
      parsed.data.fallback === parsed.data.primary
        ? null
        : parsed.data.fallback,
  };
  if (settings.ai.credential_id && settings.ai.model) {
    const policy = await aiPolicy(tx);
    const key = (await aiKeysOf(tx, ctx)).find(
      (row) => row.id === settings.ai.credential_id,
    );
    if (!key) {
      throw invalid("Escolha uma chave de IA ativa do cofre.", "aiKey");
    }
    const list = modelsOf(policy, key.provider);
    if (list && !list.includes(settings.ai.model)) {
      throw invalid("Escolha um modelo da lista.", "aiModel");
    }
  }
  for (const engine of [settings.primary, settings.fallback]) {
    if (!engine) continue;
    if (!(await resolveTranslator(tx, ctx, settings, engine))) {
      throw engine === "ai"
        ? invalid(
            "Escolha a chave de IA e o modelo do motor de IA.",
            "aiNotReady",
          )
        : invalid(
            "Cadastre a chave do Google Translate antes de usá-lo.",
            "googleNotReady",
          );
    }
  }
  if (settings.enabled && !settings.primary) {
    throw invalid(
      "Escolha um motor válido antes de ativar a tradução.",
      "noEngine",
    );
  }
  const current = await getWorkspaceModuleConfig(tx, ctx, "inbox");
  await saveWorkspaceModuleConfig(tx, ctx, "inbox", {
    ...current,
    translation: settings,
  });
  await recordAudit(tx, ctx, {
    action: "inbox.translation.update",
    resourceType: "workspace_module",
    resourceId: "inbox",
    result: "success",
    origin: "app",
    metadata: {
      enabled: settings.enabled,
      primary: settings.primary ?? "",
      fallback: settings.fallback ?? "",
      glossary: settings.glossary.length,
    },
  });
  return settings;
}

const GOOGLE_KEY = /^[A-Za-z0-9_-]{20,200}$/u;

/**
 * Saves the Google Translate key in the vault of the workspace (encrypted,
 * masked). A new key replaces the active one. `inbox.manage`.
 */
export async function saveGoogleTranslateKey(
  tx: ContextTransaction,
  ctx: RequestContext,
  secret: string,
): Promise<GoogleKeyView> {
  await assertModuleOperational(tx, ctx, "inbox", "write");
  await requireWorkspacePermission(tx, ctx, Permissions.INBOX_MANAGE);
  const value = secret.trim();
  if (!GOOGLE_KEY.test(value)) {
    throw invalid("Chave do Google inválida.", "googleKey");
  }
  const previous = await tx.credential.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      provider: GOOGLE_TRANSLATE_PROVIDER,
      status: "active",
    },
    select: { id: true, maskedValue: true },
  });
  for (const row of previous) {
    await tx.credential.update({
      where: { id: row.id },
      data: { status: "revoked" },
    });
    await recordAudit(tx, ctx, {
      action: "credentials.revoked",
      resourceType: "credential",
      resourceId: row.id,
      result: "success",
      origin: "app",
      metadata: {
        provider: GOOGLE_TRANSLATE_PROVIDER,
        maskedValue: row.maskedValue,
      },
    });
  }
  const { encryptedPayload, maskedValue } = encryptSecret(value);
  const record = await tx.credential.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      provider: GOOGLE_TRANSLATE_PROVIDER,
      purpose: "all",
      label: GOOGLE_LABEL,
      maskedValue,
      encryptedPayload,
      status: "active",
    },
    select: { id: true, maskedValue: true },
  });
  await recordAudit(tx, ctx, {
    action: "credentials.created",
    resourceType: "credential",
    resourceId: record.id,
    result: "success",
    origin: "app",
    metadata: {
      provider: GOOGLE_TRANSLATE_PROVIDER,
      purpose: "all",
      maskedValue: record.maskedValue,
    },
  });
  return { id: record.id, maskedValue: record.maskedValue };
}

export type EngineTestResult = Readonly<{
  ok: boolean;
  errorCode: TranslationErrorCode | null;
}>;

const TEST_TEXT = "Hola, ¿tienen habitación para esta noche?";

/**
 * "Testar" (as the keys of the AI agents): one short translation with the
 * engine as it is in the settings form, outside any transaction.
 */
export async function testTranslationEngine(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: Readonly<{
    engine: TranslationEngineId;
    ai: TranslationSettings["ai"];
  }>,
  deps: TranslatorDeps = {},
): Promise<EngineTestResult> {
  const prepared = await withContext(prisma, ctx, async (tx) => {
    await assertModuleOperational(tx, ctx, "inbox", "write");
    await requireWorkspacePermission(tx, ctx, Permissions.INBOX_MANAGE);
    const settings = TranslationSettings.parse({
      enabled: false,
      primary: input.engine,
      ai: input.ai,
    });
    return {
      translator: await resolveTranslator(
        tx,
        ctx,
        settings,
        input.engine,
        deps,
      ),
      target: await teamLocaleOf(tx, ctx.workspaceId),
    };
  });
  if (!prepared.translator) {
    throw input.engine === "ai"
      ? invalid(
          "Escolha a chave de IA e o modelo do motor de IA.",
          "aiNotReady",
        )
      : invalid(
          "Cadastre a chave do Google Translate antes de usá-lo.",
          "googleNotReady",
        );
  }
  let errorCode: TranslationErrorCode | null = null;
  try {
    await translateWithin(
      prepared.translator,
      {
        text: TEST_TEXT,
        source: "es",
        target: prepared.target === "es" ? "pt-BR" : prepared.target,
        glossary: [],
        context: [],
      },
      15_000,
    );
  } catch (error) {
    errorCode = error instanceof TranslationError ? error.code : "error";
    appLog.warn("inbox.translation.test_failed", {
      engine: input.engine,
      errorCode,
    });
  }
  await withContext(prisma, ctx, (tx) =>
    recordAudit(tx, ctx, {
      action: "inbox.translation.test",
      resourceType: "workspace_module",
      resourceId: "inbox",
      result: errorCode === null ? "success" : "error",
      origin: "app",
      metadata: { engine: input.engine, reason: errorCode ?? "" },
    }),
  );
  return { ok: errorCode === null, errorCode };
}

// ---------------------------------------------------------------------------
// What the window shows
// ---------------------------------------------------------------------------

export type MessageTranslationStatus = "pending" | "done" | "failed";

export type MessageTranslationDto = Readonly<{
  eventId: string;
  /** `inbound`: the contact's message for the team (TR2); `outbound`: the team's answer (TR3). */
  direction: "inbound" | "outbound";
  status: MessageTranslationStatus;
  /**
   * Inbound: the translation for the team. Outbound: the text that was sent
   * to the contact (the message of the room itself).
   */
  text: string | null;
  /** Outbound only: what the attendant wrote, in the team's language. */
  original: string | null;
  sourceLocale: ContactLocale | null;
  /** Outbound only: the contact's language the text was sent in. */
  targetLocale: ContactLocale | null;
  engine: TranslationEngineId | null;
  fallback: boolean;
  /** Outbound only: the attendant changed the preview before sending. */
  edited: boolean;
}>;

export const MAX_EVENTS_PER_READ = 200;

/**
 * The translations of the messages in view of a room, for the team's
 * language. RLS lets only who has a level in the Inbox read them.
 */
export async function loadMessageTranslations(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: Readonly<{ roomId: string; eventIds: readonly string[] }>,
  now: Date = new Date(),
): Promise<MessageTranslationDto[]> {
  const eventIds = [...new Set(input.eventIds)].slice(0, MAX_EVENTS_PER_READ);
  if (eventIds.length === 0) return [];
  const target = await teamLocaleOf(tx, ctx.workspaceId);
  const rows = await tx.inboxMessageTranslation.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      roomId: input.roomId,
      eventId: { in: eventIds },
      OR: [
        { direction: "inbound", targetLocale: target },
        // TR3: what the team sent, with the original it wrote.
        { direction: "outbound" },
      ],
    },
    select: {
      eventId: true,
      direction: true,
      status: true,
      translatedText: true,
      sourceText: true,
      sourceLocale: true,
      targetLocale: true,
      engine: true,
      fallback: true,
      edited: true,
      createdAt: true,
    },
  });
  return rows.map((row) => {
    const stale =
      row.status === "pending" &&
      now.getTime() - row.createdAt.getTime() > STALE_PENDING_MS;
    const outbound = row.direction === "outbound";
    return {
      eventId: row.eventId,
      direction: outbound ? "outbound" : "inbound",
      status: stale ? "failed" : (row.status as MessageTranslationStatus),
      text: row.status === "done" ? row.translatedText : null,
      original: outbound ? row.sourceText : null,
      sourceLocale: (row.sourceLocale as ContactLocale | null) ?? null,
      targetLocale: outbound
        ? ((row.targetLocale as ContactLocale | null) ?? null)
        : null,
      engine: (row.engine as TranslationEngineId | null) ?? null,
      fallback: row.fallback,
      edited: outbound && row.edited,
    };
  });
}
