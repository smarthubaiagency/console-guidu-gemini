"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { testGuidKey } from "@/core/ai/key-test";
import { ConfigValidationError } from "@/core/ai/templates";
import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { createGuid } from "./services/agents";
import {
  bindGuidInbox,
  releaseGuidInboxes,
  unbindGuidInbox,
} from "./services/channels";
import {
  getGuidTestConversation,
  type GuidTestConversationDto,
  sendGuidTestMessage,
} from "./services/conversations";
import {
  assertGuidDeletable,
  createReferral,
  customizeGuid,
  deleteGuid,
  deleteReferral,
  restoreFactoryPrompt,
  setGuidAvatar,
  updateGuid,
  updateReferral,
} from "./services/guid-config";

/**
 * Server actions of the GUIDS screens of `/app` (A4a and A4b): create,
 * save, customize, test the key, delete, the referrals and the chat of
 * "Testar agente". The services check the
 * module, the role and the tenant again; RLS repeats them.
 */

export type GuidActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
  /** Message of each invalid field, by `tab.field` or form field name. */
  fieldErrors?: Record<string, string>;
};

export type GuidTestActionState = GuidActionState & {
  /** The conversation the message went to. */
  conversationId?: string;
};

const slug = z.string().min(1).max(64);

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function contextFor(formData: FormData) {
  const workspaceSlug = slug.safeParse(formData.get("workspaceSlug"));
  if (!workspaceSlug.success || !isModuleTechnicallyAvailable("ai-agents")) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Recurso não encontrado.",
      messageKey: "apiErrors.notFound",
    });
  }
  const identity = await requireUser();
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug.data,
  );
  return {
    context,
    base: `/app/${workspaceSlug.data}/ai-agents`,
  };
}

async function failure(err: unknown): Promise<GuidActionState> {
  const { error, requestId } = await actionFailure(err);
  return {
    error,
    requestId,
    ...(err instanceof ConfigValidationError
      ? { fieldErrors: err.fieldErrors }
      : {}),
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ConfigValidationError({ config: "Configuração ilegível." });
  }
}

export async function createGuidAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  let target: string;
  try {
    const { context, base } = await contextFor(formData);
    const templateId = text(formData, "templateId");
    const created = await withContext(prisma, context, (tx) =>
      // "custom" is the blank GUIDS ("Personalizado").
      createGuid(tx, context, {
        templateId: templateId && templateId !== "custom" ? templateId : null,
      }),
    );
    revalidatePath(base);
    target = `${base}?edit=${created.id}`;
  } catch (err) {
    return failure(err);
  }
  redirect(target);
}

export async function saveGuidAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    const saved = await withContext(prisma, context, (tx) =>
      updateGuid(tx, context, text(formData, "agentId"), {
        status: formData.get("active") === "on" ? "active" : "paused",
        config: parseJson(text(formData, "config")),
      }),
    );
    revalidatePath(base);
    const t = await getTranslations("aiAgents.guids");
    return {
      success: true,
      message: saved.status === "active" ? t("savedActive") : t("saved"),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function customizeGuidAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    await withContext(prisma, context, (tx) =>
      customizeGuid(tx, context, text(formData, "agentId")),
    );
    revalidatePath(base);
    const t = await getTranslations("aiAgents.guids");
    return { success: true, message: t("customized") };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteGuidAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  let base: string;
  try {
    const resolved = await contextFor(formData);
    base = resolved.base;
    const agentId = text(formData, "agentId");
    // A factory GUIDS is never deleted (GF1): refused before its inboxes go.
    await withContext(prisma, resolved.context, (tx) =>
      assertGuidDeletable(tx, resolved.context, agentId),
    );
    // Its inboxes go back to nobody (and the bot leaves them) first.
    await releaseGuidInboxes(prisma, resolved.context, agentId);
    await withContext(prisma, resolved.context, (tx) =>
      deleteGuid(tx, resolved.context, agentId),
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(base);
  redirect(base);
}

/** The avatar of the gallery (GF1). */
export async function setGuidAvatarAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    await withContext(prisma, context, (tx) =>
      setGuidAvatar(
        tx,
        context,
        text(formData, "agentId"),
        text(formData, "avatar"),
      ),
    );
    revalidatePath(base);
    const t = await getTranslations("aiAgents.guids");
    return { success: true, message: t("avatarSaved") };
  } catch (err) {
    return failure(err);
  }
}

/** "Restaurar prompt de fábrica" (GF1). */
export async function restoreFactoryPromptAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    await withContext(prisma, context, (tx) =>
      restoreFactoryPrompt(tx, context, text(formData, "agentId")),
    );
    revalidatePath(base);
    const t = await getTranslations("aiAgents.guids");
    return { success: true, message: t("promptRestored") };
  } catch (err) {
    return failure(err);
  }
}

export async function testGuidKeyAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    const result = await testGuidKey(
      prisma,
      context,
      text(formData, "agentId"),
    );
    revalidatePath(base);
    const t = await getTranslations("aiAgents.guids");
    return result.ok
      ? { success: true, message: t("keyTest.ok") }
      : {
          error: t("keyTest.failed", {
            code: result.errorCode ?? "unknown",
          }),
        };
  } catch (err) {
    return failure(err);
  }
}

function referralInput(formData: FormData) {
  return {
    name: text(formData, "name"),
    referralTag: text(formData, "referralTag"),
    specialties: text(formData, "specialties")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    phone: text(formData, "phone"),
    city: text(formData, "city"),
    remote: formData.get("remote") === "on",
  };
}

export async function saveReferralAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    const agentId = text(formData, "agentId");
    const referralId = text(formData, "referralId");
    await withContext(prisma, context, (tx) =>
      referralId
        ? updateReferral(
            tx,
            context,
            agentId,
            referralId,
            referralInput(formData),
          )
        : createReferral(tx, context, agentId, referralInput(formData)),
    );
    revalidatePath(base);
    const t = await getTranslations("aiConsole.guids.referrals");
    return {
      success: true,
      message: referralId ? t("saved") : t("created"),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteReferralAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    await withContext(prisma, context, (tx) =>
      deleteReferral(
        tx,
        context,
        text(formData, "agentId"),
        text(formData, "referralId"),
      ),
    );
    revalidatePath(base);
    const t = await getTranslations("aiConsole.guids.referrals");
    return { success: true, message: t("deleted") };
  } catch (err) {
    return failure(err);
  }
}

export async function sendGuidTestAction(
  _prev: GuidTestActionState,
  formData: FormData,
): Promise<GuidTestActionState> {
  try {
    const { context } = await contextFor(formData);
    const conversationId = text(formData, "conversationId");
    const sent = await withContext(prisma, context, (tx) =>
      sendGuidTestMessage(tx, context, {
        agentId: text(formData, "agentId"),
        text: text(formData, "text"),
        ...(conversationId ? { conversationId } : {}),
      }),
    );
    return { success: true, conversationId: sent.conversationId };
  } catch (err) {
    return failure(err);
  }
}

/** The test conversation, read again while the answer is on its way. */
export async function loadGuidTestAction(
  workspaceSlug: string,
  agentId: string,
  conversationId: string,
): Promise<
  { conversation: GuidTestConversationDto | null } | { error: string }
> {
  try {
    const formData = new FormData();
    formData.append("workspaceSlug", workspaceSlug);
    const { context } = await contextFor(formData);
    const conversation = await withContext(prisma, context, (tx) =>
      getGuidTestConversation(tx, context, agentId, conversationId),
    );
    return { conversation };
  } catch (err) {
    const { error } = await actionFailure(err);
    return { error };
  }
}

export async function bindGuidInboxAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    await bindGuidInbox(prisma, context, {
      agentId: text(formData, "agentId"),
      connectionId: text(formData, "connectionId"),
      inboxId: text(formData, "inboxId"),
    });
    revalidatePath(base);
    const t = await getTranslations("aiAgents.guids.channels");
    return { success: true, message: t("bound") };
  } catch (err) {
    return failure(err);
  }
}

export async function unbindGuidInboxAction(
  _prev: GuidActionState,
  formData: FormData,
): Promise<GuidActionState> {
  try {
    const { context, base } = await contextFor(formData);
    await unbindGuidInbox(prisma, context, {
      agentId: text(formData, "agentId"),
      routeId: text(formData, "routeId"),
    });
    revalidatePath(base);
    const t = await getTranslations("aiAgents.guids.channels");
    return { success: true, message: t("unbound") };
  } catch (err) {
    return failure(err);
  }
}
