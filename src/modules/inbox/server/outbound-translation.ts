import "server-only";

import type { PrismaClient } from "@prisma/client";

import { recordAudit } from "@/core/audit/record";
import { matrixConfig } from "@/core/matrix/config";
import { type ContactLocale, isContactLocale } from "@/core/matrix/locale";
import { createSynapseClient, type SynapseClient } from "@/core/matrix/synapse";
import { assertModuleOperational } from "@/core/module-runtime/state";
import {
  decideOutbound,
  type OutboundReason,
} from "@/core/translation/outbound";
import { translateOutbound } from "@/core/translation/run";
import {
  TranslationError,
  type TranslationEngineId,
  type TranslationErrorCode,
  type Translator,
} from "@/core/translation/types";
import { type RequestContext, withContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import { translationSettingsOf } from "../translation-settings";
import { loadInboxViewer } from "./access";
import {
  resolveTranslator,
  teamLocaleOf,
  type TranslatorDeps,
} from "./translation";

/**
 * The team's answer with a translated preview (TR3, docs/modules/inbox/
 * traducao.md §5.2). Two steps, both for who answers (level `reply`):
 *
 * 1. `previewOutboundTranslation`: translates what the attendant wrote into
 *    the contact's language with the engines of the TR2 (main engine, the
 *    4 s, the fallback, the glossary, the text as data). Writes nothing and
 *    sends nothing to the room: the browser shows the preview.
 * 2. `recordOutboundTranslation`: after Synapse accepted the message (the
 *    browser sends it with matrix-js-sdk), reads the event on Synapse as
 *    the core, confirms that the sender is the Matrix account of the person
 *    and that the body is the text sent, and only then records the `outbound`
 *    row through `private.inbox_translation_record_outbound`, which checks
 *    the level, the room and that the event has no registration yet.
 */

/** Longest text translated or recorded in one answer. */
export const OUTBOUND_MAX = 4_000;

export type OutboundPreview =
  /** Nothing to translate: the window sends the text as it is. */
  | Readonly<{ kind: "direct"; reason: OutboundReason }>
  | Readonly<{
      kind: "preview";
      text: string;
      sourceLocale: ContactLocale;
      targetLocale: ContactLocale;
      engine: TranslationEngineId;
      model: string | null;
      fallback: boolean;
    }>
  /** Both engines failed: the window does not send by itself. */
  | Readonly<{
      kind: "unavailable";
      sourceLocale: ContactLocale;
      targetLocale: ContactLocale;
      code: TranslationErrorCode;
    }>;

export type OutboundDeps = TranslatorDeps &
  Readonly<{
    client?: SynapseClient;
    timeouts?: Readonly<{ primaryMs?: number; fallbackMs?: number }>;
  }>;

function denied(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não tem permissão para esta ação.",
    messageKey: "errors.permissionDenied",
  });
}

function conversationNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Conversa não encontrada.",
    messageKey: "inbox.errors.conversationNotFound",
  });
}

function notSent(): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: "A mensagem enviada não confere com o registro.",
    messageKey: "inbox.translation.outbound.errors.mismatch",
  });
}

/** The main engine without its key: fails at once as a refused key. */
const missingEngine: Translator = {
  engine: "ai",
  model: null,
  translate: () => Promise.reject(new TranslationError("key")),
};

export async function previewOutboundTranslation(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: Readonly<{ roomId: string; text: string; force?: boolean }>,
  deps: OutboundDeps = {},
): Promise<OutboundPreview> {
  const text = input.text.trim();
  if (!text || text.length > OUTBOUND_MAX) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "O texto da resposta é inválido.",
      messageKey: "inbox.translation.outbound.errors.text",
    });
  }
  // Reads inside the transaction; the engines are called outside it.
  const prepared = await withContext(prisma, ctx, async (tx) => {
    await assertModuleOperational(tx, ctx, "inbox", "write");
    const viewer = await loadInboxViewer(tx, ctx.userId);
    if (viewer.level !== "reply") throw denied();
    const room = await tx.matrixRoom.findFirst({
      where: { roomId: input.roomId, workspaceId: ctx.workspaceId },
      select: { contactLocale: true, state: true },
    });
    if (!room || room.state !== "active") throw conversationNotFound();
    const inboxModule = await tx.workspaceModule.findFirst({
      where: { workspaceId: ctx.workspaceId, moduleKey: "inbox" },
      select: { config: true },
    });
    const settings = translationSettingsOf(inboxModule?.config);
    const decision = decideOutbound({
      enabled: settings.enabled && settings.primary !== null,
      mode: "reply",
      teamLocale: await teamLocaleOf(tx, ctx.workspaceId),
      contactLocale: isContactLocale(room.contactLocale)
        ? room.contactLocale
        : null,
      text,
      ...(input.force ? { force: true } : {}),
    });
    if (!decision.translate || !settings.primary) {
      return { decision, primary: null, fallback: null, glossary: [] } as const;
    }
    return {
      decision,
      primary: await resolveTranslator(
        tx,
        ctx,
        settings,
        settings.primary,
        deps,
      ),
      fallback: settings.fallback
        ? await resolveTranslator(tx, ctx, settings, settings.fallback, deps)
        : null,
      glossary: settings.glossary,
    } as const;
  });
  if (!prepared.decision.translate) {
    return { kind: "direct", reason: prepared.decision.reason };
  }
  const { source, target } = prepared.decision;
  // A main engine without its key gives way to the fallback, as in the job.
  const outcome =
    prepared.primary === null && prepared.fallback === null
      ? ({
          ok: false,
          primaryError: "key",
          fallbackError: null,
        } as const)
      : await translateOutbound(
          {
            primary: prepared.primary ?? missingEngine,
            fallback: prepared.fallback,
          },
          { text, source, target, glossary: prepared.glossary },
          deps.timeouts,
        );
  if (!outcome.ok) {
    appLog.warn("inbox.translation.preview_failed", {
      workspaceId: ctx.workspaceId,
      primaryError: outcome.primaryError,
      fallbackError: outcome.fallbackError ?? "",
    });
    return {
      kind: "unavailable",
      sourceLocale: source,
      targetLocale: target,
      code: outcome.primaryError,
    };
  }
  return {
    kind: "preview",
    text: outcome.translation.text.slice(0, OUTBOUND_MAX),
    sourceLocale: source,
    targetLocale: target,
    engine: outcome.translation.engine,
    model: outcome.translation.model,
    fallback: outcome.fallback,
  };
}

export type OutboundRecordInput = Readonly<{
  roomId: string;
  eventId: string;
  /** What the attendant wrote, in the team's language. */
  sourceText: string;
  /** What was sent to the room. */
  sentText: string;
  sourceLocale: ContactLocale;
  targetLocale: ContactLocale;
  engine: TranslationEngineId;
  model: string | null;
  fallback: boolean;
  edited: boolean;
}>;

function synapse(deps: OutboundDeps): SynapseClient {
  if (deps.client) return deps.client;
  const config = matrixConfig();
  if (!config) {
    throw new AppError({
      code: "unavailable",
      safeMessage: "O chat não está configurado.",
      messageKey: "inbox.chatUnavailable",
    });
  }
  return createSynapseClient(config);
}

/** The text message of the event on Synapse, read as the core. */
async function readSent(
  client: SynapseClient,
  roomId: string,
  eventId: string,
): Promise<{ sender: string; body: string } | null> {
  const enc = encodeURIComponent;
  let event: Record<string, unknown>;
  try {
    event = await client.request<Record<string, unknown>>(
      "GET",
      `/_matrix/client/v3/rooms/${enc(roomId)}/event/${enc(eventId)}`,
    );
  } catch {
    return null;
  }
  const content = (event.content ?? {}) as { [key: string]: unknown };
  if (
    event.type !== "m.room.message" ||
    typeof event.sender !== "string" ||
    typeof content.body !== "string" ||
    content.msgtype !== "m.text"
  ) {
    return null;
  }
  return { sender: event.sender, body: content.body };
}

/**
 * Records the translated sending of the person. Returns false when the
 * event already had a registration. Refuses (no write) when the person has
 * no level `reply` or no Matrix account, the room is not of the workspace,
 * or the event on Synapse is not a message of that account with that body.
 */
export async function recordOutboundTranslation(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: OutboundRecordInput,
  deps: OutboundDeps = {},
): Promise<{ recorded: boolean }> {
  const mxid = await withContext(prisma, ctx, async (tx) => {
    await assertModuleOperational(tx, ctx, "inbox", "write");
    const viewer = await loadInboxViewer(tx, ctx.userId);
    if (viewer.level !== "reply" || !viewer.mxid) throw denied();
    const room = await tx.matrixRoom.findFirst({
      where: {
        roomId: input.roomId,
        workspaceId: ctx.workspaceId,
        state: "active",
      },
      select: { roomId: true },
    });
    if (!room) throw conversationNotFound();
    return viewer.mxid;
  });
  const sent = await readSent(synapse(deps), input.roomId, input.eventId);
  if (!sent || sent.sender !== mxid || sent.body !== input.sentText) {
    throw notSent();
  }
  return withContext(prisma, ctx, async (tx) => {
    const rows = await tx.$queryRaw<{ ok: boolean }[]>`
      select private.inbox_translation_record_outbound(
        ${input.roomId}::text, ${input.eventId}::text, ${input.sourceText}::text,
        ${input.sentText}::text, ${input.sourceLocale}::text, ${input.targetLocale}::text,
        ${input.engine}::text, ${input.model}::text, ${input.fallback}::boolean,
        ${input.edited}::boolean
      ) as ok
    `;
    const recorded = rows[0]?.ok === true;
    if (recorded) {
      // Never the text: only how it was translated.
      await recordAudit(tx, ctx, {
        action: "inbox.translation.outbound",
        resourceType: "matrix_room",
        resourceId: input.roomId,
        result: "success",
        origin: "app",
        metadata: {
          from: input.sourceLocale,
          to: input.targetLocale,
          provider: input.engine,
          status: input.edited ? "edited" : "as_translated",
        },
      });
    }
    return { recorded };
  });
}
