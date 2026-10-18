"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  ChannelInputError,
  checkChannelConnection,
  createChatwootConnection,
  deleteChannelConnection,
  updateServiceSettings,
} from "./connections";
import {
  completeMetaEmbeddedSignup,
  createMetaConnection,
  setMetaRoute,
} from "./meta-connections";

/**
 * Server actions of Configurações › Canais (A5a). The services check the
 * permission and the tenant again; RLS repeats them.
 */

export type ChannelActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
  /** Message of each invalid field, by form field name. */
  fieldErrors?: Record<string, string>;
};

const slug = z.string().min(1).max(64);

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function contextFor(formData: FormData) {
  const workspaceSlug = slug.safeParse(formData.get("workspaceSlug"));
  if (!workspaceSlug.success) {
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
    path: `/app/${workspaceSlug.data}/settings/channels`,
  };
}

async function failure(err: unknown): Promise<ChannelActionState> {
  const { error, requestId } = await actionFailure(err);
  return {
    error,
    requestId,
    ...(err instanceof ChannelInputError
      ? { fieldErrors: err.fieldErrors }
      : {}),
  };
}

export async function createChatwootConnectionAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const { context, path } = await contextFor(formData);
    const created = await createChatwootConnection(prisma, context, {
      name: text(formData, "name"),
      baseUrl: text(formData, "baseUrl"),
      accountId: text(formData, "accountId"),
      accessToken: text(formData, "accessToken"),
    });
    revalidatePath(path);
    const t = await getTranslations("channels");
    return {
      success: true,
      message:
        created.healthStatus === "ok"
          ? t("created", { count: created.inboxes.length })
          : t("createdUnchecked"),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function checkChannelConnectionAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const { context, path } = await contextFor(formData);
    const checked = await checkChannelConnection(
      prisma,
      context,
      text(formData, "connectionId"),
    );
    revalidatePath(path);
    const t = await getTranslations("channels");
    return checked.healthStatus === "ok"
      ? {
          success: true,
          message: checked.meta
            ? t("meta.checkOk")
            : t("checkOk", { count: checked.inboxes.length }),
        }
      : {
          error: t("checkFailed", {
            reason: t(`health.${checked.healthError ?? "unknown"}`),
          }),
        };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteChannelConnectionAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const { context, path } = await contextFor(formData);
    await deleteChannelConnection(
      prisma,
      context,
      text(formData, "connectionId"),
    );
    revalidatePath(path);
    const t = await getTranslations("channels");
    return { success: true, message: t("deleted") };
  } catch (err) {
    return failure(err);
  }
}

const SETTING_FIELDS = [
  "grouping_seconds",
  "max_messages",
  "max_chars",
  "interval_ms",
  "voice_reply",
] as const;

/** Service settings of the integration, for every inbox or for one. */
export async function updateServiceSettingsAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const { context, path } = await contextFor(formData);
    const scope = text(formData, "scope");
    const reset = formData.get("reset") === "1";
    await withContext(prisma, context, (tx) =>
      updateServiceSettings(tx, context, {
        connectionId: text(formData, "connectionId"),
        scope: scope && scope !== "defaults" ? scope : null,
        settings: reset
          ? null
          : Object.fromEntries(
              SETTING_FIELDS.map((field) => [field, text(formData, field)]),
            ),
      }),
    );
    revalidatePath(path);
    const t = await getTranslations("channels");
    return {
      success: true,
      message: reset ? t("service.reset") : t("service.saved"),
    };
  } catch (err) {
    return failure(err);
  }
}

/** A number of Meta linked by hand (IN7a). */
export async function createMetaConnectionAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const { context, path } = await contextFor(formData);
    await createMetaConnection(prisma, context, {
      name: text(formData, "name"),
      phoneNumberId: text(formData, "phoneNumberId"),
      wabaId: text(formData, "wabaId"),
      accessToken: text(formData, "accessToken"),
    });
    revalidatePath(path);
    const t = await getTranslations("channels");
    return { success: true, message: t("meta.created") };
  } catch (err) {
    return failure(err);
  }
}

/** A number of Meta linked by the Embedded Signup (IN7a). */
export async function completeMetaEmbeddedSignupAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const { context, path } = await contextFor(formData);
    const pin = text(formData, "pin");
    await completeMetaEmbeddedSignup(prisma, context, {
      name: text(formData, "name"),
      code: text(formData, "code"),
      phoneNumberId: text(formData, "phoneNumberId"),
      wabaId: text(formData, "wabaId"),
      ...(pin ? { pin } : {}),
    });
    revalidatePath(path);
    const t = await getTranslations("channels");
    return { success: true, message: t("meta.created") };
  } catch (err) {
    return failure(err);
  }
}

/** Which GUIDS answers a number of Meta, or nobody (IN7a). */
export async function setMetaRouteAction(
  _prev: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const { context, path } = await contextFor(formData);
    const agentId = text(formData, "agentId");
    await withContext(prisma, context, (tx) =>
      setMetaRoute(tx, context, {
        connectionId: text(formData, "connectionId"),
        agentId: agentId || null,
      }),
    );
    revalidatePath(path);
    const t = await getTranslations("channels");
    return {
      success: true,
      message: agentId ? t("meta.routeSaved") : t("meta.routeCleared"),
    };
  } catch (err) {
    return failure(err);
  }
}
