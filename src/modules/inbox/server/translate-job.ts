import "server-only";

import { z } from "zod";

import {
  defineDetachedJob,
  type JobResult,
  type JobSession,
} from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import { recentMessages } from "@/core/matrix/agent";
import { matrixConfig } from "@/core/matrix/config";
import { messageSide } from "@/core/matrix/events";
import {
  type ContactLocale,
  detectContactLocale,
  isContactLocale,
} from "@/core/matrix/locale";
import { createSynapseClient, type SynapseClient } from "@/core/matrix/synapse";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { ModuleUnavailableError } from "@/core/modules/availability";
import {
  type TranslationOutcome,
  translateWithFallback,
} from "@/core/translation/run";
import { isShortMessage } from "@/core/translation/short";
import {
  type GlossaryEntry,
  type TranslationContextLine,
  TranslationError,
  type TranslationErrorCode,
  type Translator,
} from "@/core/translation/types";
import type { RequestContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";

import { translationSettingsOf } from "../translation-settings";
import {
  resolveTranslator,
  teamLocaleOf,
  type TranslatorDeps,
} from "./translation";

/**
 * Translation of a message of the contact or of the GUIDS for the team
 * (TR2, docs/modules/inbox/traducao.md §5.1 and §5.3): a detached job of
 * the worker, enqueued by the core as it processes the message
 * (`private.inbox_translation_enqueue`, with the pending row) and run as
 * the person who saved the Inbox settings. The payload has only the room
 * and the event: the text is read here, from Synapse, as the core.
 *
 * 1. Reads the room, the pending row, the settings and the engines (keys
 *    of the vault, decrypted only for the call).
 * 2. Reads the event and, for the AI engine, the latest messages as
 *    context. A short message ("ok", an emoji), one in the team's
 *    language or not a text of the contact or of the GUIDS is not
 *    translated: the pending row goes.
 * 3. Main engine, then the fallback (4 s, error, refusal, quota).
 * 4. Records the result through `private.inbox_translation_record`, which
 *    only this run may call. With both engines failing it records the
 *    failure and throws, so the worker tries again (three attempts).
 */

export const INBOX_TRANSLATE_KIND = "inbox.translate-message";
const MAX_ATTEMPTS = 3;
/** Longest text sent to an engine. */
const MAX_TEXT = 4_000;
/** Messages before this one given to the AI engine. */
const MAX_CONTEXT = 6;

const enc = encodeURIComponent;

export const TranslatePayload = z.strictObject({
  roomId: z.string().regex(/^![^\s]{1,254}$/),
  eventId: z.string().regex(/^\$[^\s]{1,254}$/),
});
export type TranslatePayload = z.infer<typeof TranslatePayload>;

export type TranslateJobDeps = TranslatorDeps &
  Readonly<{
    client?: SynapseClient;
    timeouts?: Readonly<{ primaryMs?: number; fallbackMs?: number }>;
  }>;

const TEXT_TYPES = ["m.text", "m.notice", "m.emote"];

type Loaded = Readonly<{
  consumerMxid: string | null;
  contactLocale: ContactLocale | null;
  rowSource: ContactLocale | null;
  target: ContactLocale;
  glossary: readonly GlossaryEntry[];
  primary: Translator | null;
  fallback: Translator | null;
}>;

async function load(
  session: JobSession,
  ctx: RequestContext,
  payload: TranslatePayload,
  deps: TranslateJobDeps,
): Promise<Loaded | "nothing" | "off"> {
  return session.transaction(async (tx) => {
    try {
      await assertModuleOperational(tx, ctx, "inbox", "read");
    } catch (error) {
      if (error instanceof ModuleUnavailableError) {
        throw new SkipJobError("O Inbox não está disponível neste workspace.");
      }
      throw error;
    }
    const room = await tx.matrixRoom.findFirst({
      where: {
        roomId: payload.roomId,
        workspaceId: ctx.workspaceId,
        state: "active",
      },
      select: { consumerMxid: true, contactLocale: true },
    });
    if (!room) throw new SkipJobError("Conversa não encontrada.");
    const target = await teamLocaleOf(tx, ctx.workspaceId);
    const row = await tx.inboxMessageTranslation.findFirst({
      where: {
        eventId: payload.eventId,
        roomId: payload.roomId,
        workspaceId: ctx.workspaceId,
        targetLocale: target,
      },
      select: { status: true, sourceLocale: true },
    });
    if (!row || row.status === "done") return "nothing";
    const inboxModule = await tx.workspaceModule.findFirst({
      where: { workspaceId: ctx.workspaceId, moduleKey: "inbox" },
      select: { config: true },
    });
    const settings = translationSettingsOf(inboxModule?.config);
    if (!settings.enabled || !settings.primary) return "off";
    const primary = await resolveTranslator(
      tx,
      ctx,
      settings,
      settings.primary,
      deps,
    );
    const fallback = settings.fallback
      ? await resolveTranslator(tx, ctx, settings, settings.fallback, deps)
      : null;
    return {
      consumerMxid: room.consumerMxid,
      contactLocale: isContactLocale(room.contactLocale)
        ? room.contactLocale
        : null,
      rowSource: isContactLocale(row.sourceLocale) ? row.sourceLocale : null,
      target,
      glossary: settings.glossary,
      primary,
      fallback,
    };
  });
}

type RecordInput = Readonly<{
  status: "done" | "failed" | "skipped";
  source?: ContactLocale | null;
  text?: string | null;
  engine?: string | null;
  model?: string | null;
  fallback?: boolean;
  primaryError?: TranslationErrorCode | null;
}>;

async function record(
  session: JobSession,
  payload: TranslatePayload,
  result: RecordInput,
): Promise<number> {
  return session.transaction(async (tx) => {
    await tx.$queryRaw`
      select private.inbox_translation_record(
        ${session.jobRunId}::uuid, ${payload.eventId}::text, ${result.status}::text,
        ${result.source ?? null}::text, ${result.text ?? null}::text,
        ${result.engine ?? null}::text, ${result.model ?? null}::text,
        ${result.fallback ?? false}::boolean, ${result.primaryError ?? null}::text
      ) as ok
    `;
    if (result.status !== "failed") return 0;
    const row = await tx.inboxMessageTranslation.findFirst({
      where: { eventId: payload.eventId, roomId: payload.roomId },
      select: { attempts: true },
    });
    return row?.attempts ?? MAX_ATTEMPTS;
  });
}

function synapse(deps: TranslateJobDeps): SynapseClient {
  if (deps.client) return deps.client;
  const config = matrixConfig();
  if (!config) throw new SkipJobError("Matrix não configurado.");
  return createSynapseClient(config);
}

type RoomEvent = Readonly<{
  sender: string;
  ts: number;
  body: string;
}>;

/** The text message of the event, read as the core; null otherwise. */
async function readEvent(
  client: SynapseClient,
  payload: TranslatePayload,
): Promise<RoomEvent | null> {
  const event = await client.request<Record<string, unknown>>(
    "GET",
    `/_matrix/client/v3/rooms/${enc(payload.roomId)}/event/${enc(payload.eventId)}`,
  );
  const content = (event.content ?? {}) as { [key: string]: unknown };
  if (
    event.type !== "m.room.message" ||
    typeof event.sender !== "string" ||
    typeof content.body !== "string" ||
    !TEXT_TYPES.includes(String(content.msgtype))
  ) {
    return null;
  }
  return {
    sender: event.sender,
    ts: typeof event.origin_server_ts === "number" ? event.origin_server_ts : 0,
    body: content.body,
  };
}

/** What was said just before, as data for the AI engine. */
async function contextOf(
  client: SynapseClient,
  payload: TranslatePayload,
  event: RoomEvent,
  consumerMxid: string | null,
): Promise<TranslationContextLine[]> {
  try {
    const messages = await recentMessages(client, payload.roomId, 30);
    const lines: TranslationContextLine[] = [];
    for (const message of messages) {
      if (message.status || message.eventId === payload.eventId) continue;
      if (message.ts > event.ts) continue;
      const side = messageSide(client, message.sender, consumerMxid);
      if (!side) continue;
      lines.push({
        side: side === "consumer" ? "contact" : side,
        text: message.body,
      });
    }
    return lines.slice(-MAX_CONTEXT);
  } catch {
    // The translation goes on without context.
    return [];
  }
}

export async function runTranslateMessage(
  session: JobSession,
  ctx: RequestContext,
  payload: TranslatePayload,
  deps: TranslateJobDeps = {},
): Promise<JobResult> {
  const loaded = await load(session, ctx, payload, deps);
  if (loaded === "nothing") return { status: "nothing_to_do" };
  if (loaded === "off") {
    await record(session, payload, { status: "skipped" });
    return { status: "off" };
  }
  const client = synapse(deps);
  const event = await readEvent(client, payload);
  const side = event
    ? messageSide(client, event.sender, loaded.consumerMxid)
    : null;
  if (!event || (side !== "consumer" && side !== "agent")) {
    await record(session, payload, { status: "skipped" });
    return { status: "not_translatable" };
  }
  const text = event.body.trim().slice(0, MAX_TEXT);
  if (isShortMessage(text)) {
    await record(session, payload, { status: "skipped" });
    return { status: "short" };
  }
  const source =
    detectContactLocale(text)?.locale ??
    loaded.rowSource ??
    loaded.contactLocale;
  if (!source || source === loaded.target) {
    await record(session, payload, { status: "skipped" });
    return { status: "same_language" };
  }

  const engines = [loaded.primary, loaded.fallback].filter(
    (engine): engine is Translator => engine !== null,
  );
  let outcome: TranslationOutcome;
  if (engines.length === 0) {
    // The keys were revoked after the translation was turned on.
    outcome = { ok: false, primaryError: "key", fallbackError: null };
  } else {
    const usesAi = engines.some((engine) => engine.engine === "ai");
    outcome = await translateWithFallback(
      // A main engine without its key gives way to the fallback, marked so.
      { primary: loaded.primary ?? missingEngine, fallback: loaded.fallback },
      {
        text,
        source,
        target: loaded.target,
        glossary: loaded.glossary,
        context: usesAi
          ? await contextOf(client, payload, event, loaded.consumerMxid)
          : [],
      },
      deps.timeouts,
    );
  }

  if (outcome.ok) {
    await record(session, payload, {
      status: "done",
      source,
      text: outcome.translation.text.slice(0, 8000),
      engine: outcome.translation.engine,
      model: outcome.translation.model,
      fallback: outcome.fallback,
      primaryError: outcome.primaryError,
    });
    return {
      status: "translated",
      engine: outcome.translation.engine,
      fallback: outcome.fallback,
    };
  }
  const attempts = await record(session, payload, {
    status: "failed",
    source,
    primaryError: outcome.primaryError,
  });
  appLog.warn("inbox.translation.failed", {
    executionId: session.jobRunId,
    workspaceId: ctx.workspaceId,
    primaryError: outcome.primaryError,
    fallbackError: outcome.fallbackError ?? "",
    attempts,
  });
  if (attempts < MAX_ATTEMPTS) {
    // The worker tries again later; the window shows the original.
    throw new Error("Os motores de tradução falharam; nova tentativa.");
  }
  return { status: "failed", attempts };
}

/** The main engine without a key: fails at once as a refused key. */
const missingEngine: Translator = {
  engine: "ai",
  model: null,
  translate: () => Promise.reject(new TranslationError("key")),
};

export function createTranslateMessageJob(deps: TranslateJobDeps = {}) {
  return defineDetachedJob<TranslatePayload>({
    kind: INBOX_TRANSLATE_KIND,
    description: "Tradução de uma mensagem do Inbox para o idioma da equipe.",
    payload: TranslatePayload,
    maxAttempts: MAX_ATTEMPTS,
    retryDelaySeconds: 20,
    expireInSeconds: 90,
    group: (payload) => payload.roomId,
    run: (session, ctx, payload) =>
      runTranslateMessage(session, ctx, payload, deps),
  });
}

export const translateMessageJob = createTranslateMessageJob();
