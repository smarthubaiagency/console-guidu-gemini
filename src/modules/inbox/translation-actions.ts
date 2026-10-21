"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { Permissions } from "@/core/permissions/catalog";
import { parseGlossary } from "@/core/translation/glossary";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { loadInboxViewer } from "./server/access";
import {
  OUTBOUND_MAX,
  type OutboundPreview,
  previewOutboundTranslation,
  recordOutboundTranslation,
} from "./server/outbound-translation";
import {
  type EngineTestResult,
  type GoogleKeyView,
  loadMessageTranslations,
  MAX_EVENTS_PER_READ,
  type MessageTranslationDto,
  saveGoogleTranslateKey,
  saveTranslationSettings,
  testTranslationEngine,
  translationNotice,
  type TranslationNotice,
} from "./server/translation";
import { translationSettingsOf } from "./translation-settings";

/**
 * Server actions of the translation of the chat (TR2): the block
 * "Tradução" of the Inbox settings, the Google key, the test of an engine
 * and the translations of the messages in view. Each one resolves the
 * workspace, the module and the person's permission again.
 */

type Failure = Readonly<{ error: string; requestId?: string }>;

const slug = z.string().min(1).max(120);
const roomId = z.string().regex(/^![^\s]{1,254}$/);
const engine = z.enum(["ai", "google"]);

async function contextOf(workspaceSlug: string) {
  const identity = await requireUser();
  return resolveRequestWorkspaceContext(prisma, identity.userId, workspaceSlug);
}

const SettingsInput = z.object({
  workspaceSlug: slug,
  enabled: z.boolean(),
  primary: engine.nullable(),
  fallback: engine.nullable(),
  aiCredentialId: z.uuid().nullable(),
  aiModel: z.string().trim().max(120).nullable(),
  glossary: z.string().max(40_000),
});

export async function saveTranslationSettingsAction(
  input: z.input<typeof SettingsInput>,
): Promise<{ message: string } | Failure> {
  try {
    const parsed = SettingsInput.safeParse(input);
    if (!parsed.success) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Confira os campos da tradução.",
        messageKey: "inboxGuids.translation.errors.invalid",
      });
    }
    const data = parsed.data;
    const context = await contextOf(data.workspaceSlug);
    await withContext(prisma, context, (tx) =>
      saveTranslationSettings(tx, context, {
        enabled: data.enabled,
        primary: data.primary,
        fallback: data.fallback,
        ai: {
          credential_id: data.aiCredentialId,
          model: data.aiModel || null,
        },
        glossary: parseGlossary(data.glossary),
      }),
    );
    revalidatePath(`/app/${data.workspaceSlug}/settings/modules/inbox`);
    const t = await getTranslations("inboxGuids.translation");
    return { message: t("saved") };
  } catch (error) {
    return actionFailure(error);
  }
}

const GoogleKeyInput = z.object({
  workspaceSlug: slug,
  secret: z.string().max(300),
});

export async function saveGoogleTranslateKeyAction(
  input: z.input<typeof GoogleKeyInput>,
): Promise<{ key: GoogleKeyView; message: string } | Failure> {
  try {
    const data = GoogleKeyInput.parse(input);
    const context = await contextOf(data.workspaceSlug);
    const key = await withContext(prisma, context, (tx) =>
      saveGoogleTranslateKey(tx, context, data.secret),
    );
    revalidatePath(`/app/${data.workspaceSlug}/settings/modules/inbox`);
    const t = await getTranslations("inboxGuids.translation");
    return { key, message: t("google.saved") };
  } catch (error) {
    return actionFailure(error);
  }
}

const TestInput = z.object({
  workspaceSlug: slug,
  engine,
  aiCredentialId: z.uuid().nullable(),
  aiModel: z.string().trim().max(120).nullable(),
});

export async function testTranslationEngineAction(
  input: z.input<typeof TestInput>,
): Promise<{ result: EngineTestResult } | Failure> {
  try {
    const data = TestInput.parse(input);
    const context = await contextOf(data.workspaceSlug);
    const result = await testTranslationEngine(prisma, context, {
      engine: data.engine,
      ai: {
        credential_id: data.aiCredentialId,
        model: data.aiModel || null,
      },
    });
    return { result };
  } catch (error) {
    return actionFailure(error);
  }
}

const ReadInput = z.object({
  workspaceSlug: slug,
  roomId,
  eventIds: z
    .array(z.string().regex(/^\$[^\s]{1,254}$/))
    .max(MAX_EVENTS_PER_READ),
});

/**
 * The translations of the messages in view of a conversation and the
 * notice of a failing engine (the window asks again when messages arrive).
 */
export async function loadMessageTranslationsAction(
  input: z.input<typeof ReadInput>,
): Promise<
  | {
      translations: MessageTranslationDto[];
      notice: TranslationNotice | null;
    }
  | Failure
> {
  try {
    const data = ReadInput.parse(input);
    const context = await contextOf(data.workspaceSlug);
    return await withContext(prisma, context, async (tx) => {
      const access = await resolveModulePageAccess(
        tx,
        context,
        "inbox",
        Permissions.INBOX_VIEW,
      );
      const viewer = await loadInboxViewer(tx, context.userId);
      if (access.kind !== "ok" || viewer.level === null) {
        throw new AppError({
          code: "forbidden",
          safeMessage: "Você não tem permissão para esta ação.",
          messageKey: "errors.permissionDenied",
        });
      }
      const inboxModule = await tx.workspaceModule.findFirst({
        where: { workspaceId: context.workspaceId, moduleKey: "inbox" },
        select: { config: true },
      });
      const settings = translationSettingsOf(inboxModule?.config);
      return {
        translations: await loadMessageTranslations(tx, context, {
          roomId: data.roomId,
          eventIds: data.eventIds,
        }),
        notice: await translationNotice(tx, context, settings),
      };
    });
  } catch (error) {
    return actionFailure(error);
  }
}

const locale = z.enum(["pt-BR", "en", "es"]);

const PreviewInput = z.object({
  workspaceSlug: slug,
  roomId,
  text: z.string().max(OUTBOUND_MAX * 2),
  /** The ✦: the preview even for a draft already in the contact's language. */
  force: z.boolean().optional(),
});

/**
 * TR3: the preview of the team's answer in the contact's language. Needs
 * level `reply` (checked in the service, as the send is); writes nothing
 * and sends nothing to the room.
 */
export async function previewOutboundTranslationAction(
  input: z.input<typeof PreviewInput>,
): Promise<{ preview: OutboundPreview } | Failure> {
  try {
    const data = PreviewInput.parse(input);
    const context = await contextOf(data.workspaceSlug);
    const preview = await previewOutboundTranslation(prisma, context, {
      roomId: data.roomId,
      text: data.text,
      ...(data.force ? { force: true } : {}),
    });
    return { preview };
  } catch (error) {
    return actionFailure(error);
  }
}

const RecordInput = z.object({
  workspaceSlug: slug,
  roomId,
  eventId: z.string().regex(/^$[^s]{1,254}$/),
  sourceText: z.string().min(1).max(OUTBOUND_MAX),
  sentText: z.string().min(1).max(OUTBOUND_MAX),
  sourceLocale: locale,
  targetLocale: locale,
  engine,
  model: z.string().trim().min(1).max(120).nullable(),
  fallback: z.boolean(),
  edited: z.boolean(),
});

/**
 * TR3: after Synapse accepted the message sent from the browser, records
 * how it was translated: the original of the team, tied to the event. The
 * service reads the event on Synapse and refuses a sender or a body that
 * does not match; the database repeats the level and the room.
 */
export async function recordOutboundTranslationAction(
  input: z.input<typeof RecordInput>,
): Promise<{ recorded: boolean } | Failure> {
  try {
    const { workspaceSlug, ...data } = RecordInput.parse(input);
    const context = await contextOf(workspaceSlug);
    return await recordOutboundTranslation(prisma, context, data);
  } catch (error) {
    return actionFailure(error);
  }
}
