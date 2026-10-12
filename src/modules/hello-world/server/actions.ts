"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import {
  savePlatformModuleConfig,
  saveWorkspaceModuleConfig,
} from "@/core/module-runtime/settings";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError, type AppErrorCode } from "@/shared/errors";

import {
  createHelloWorldRecord,
  enqueueHelloWorldRecord,
} from "./services/records";

export type HelloWorldActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
  recordId?: string;
};

const MODULE_KEY = "hello-world";

function invalidInput(): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: "Dados inválidos.",
    messageKey: "helloWorld.errors.invalidInput",
  });
}

const slug = z.string().min(1).max(64);

/** Empty input means "inherit": the key is dropped from the stored config. */
function optionalText(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : undefined;
}

export async function createHelloWorldRecordAction(
  _prev: HelloWorldActionState,
  formData: FormData,
): Promise<HelloWorldActionState> {
  const workspaceSlug = slug.safeParse(formData.get("workspaceSlug"));
  if (!workspaceSlug.success) {
    return actionFailure(invalidInput());
  }
  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug.data,
    );
    if (formData.get("mode") === "background") {
      await withContext(prisma, context, (tx) =>
        enqueueHelloWorldRecord(tx, context, { title: formData.get("title") }),
      );
      revalidatePath(`/app/${workspaceSlug.data}/executions`);
      const t = await getTranslations("helloWorld");
      return {
        success: true,
        message: t("actions.backgroundRequested"),
      };
    }
    const record = await withContext(prisma, context, (tx) =>
      createHelloWorldRecord(tx, context, { title: formData.get("title") }),
    );
    revalidatePath(`/app/${workspaceSlug.data}/hello-world`, "layout");
    const t = await getTranslations("helloWorld");
    return {
      success: true,
      message: t("actions.recordCreated"),
      recordId: record.id,
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function saveHelloWorldWorkspaceSettingsAction(
  _prev: HelloWorldActionState,
  formData: FormData,
): Promise<HelloWorldActionState> {
  const workspaceSlug = slug.safeParse(formData.get("workspaceSlug"));
  if (!workspaceSlug.success) {
    return actionFailure(invalidInput());
  }
  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug.data,
    );
    const greeting = optionalText(formData.get("greeting"));
    await withContext(prisma, context, (tx) =>
      saveWorkspaceModuleConfig(
        tx,
        context,
        MODULE_KEY,
        greeting ? { greeting } : {},
      ),
    );
    revalidatePath(`/app/${workspaceSlug.data}`, "layout");
    const t = await getTranslations("helloWorld");
    return { success: true, message: t("actions.settingsSaved") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function saveHelloWorldAdminSettingsAction(
  _prev: HelloWorldActionState,
  formData: FormData,
): Promise<HelloWorldActionState> {
  try {
    const identity = await requireMfa();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    const defaultGreeting = optionalText(formData.get("defaultGreeting"));
    await withIdentityContext(prisma, identity.userId, (tx) =>
      savePlatformModuleConfig(
        tx,
        identity.userId,
        admin?.role ?? null,
        MODULE_KEY,
        defaultGreeting ? { defaultGreeting } : {},
      ),
    );
    revalidatePath(`/platform/settings/modules/${MODULE_KEY}`);
    revalidatePath("/app", "layout");
    const t = await getTranslations("helloWorld");
    return { success: true, message: t("actions.policySaved") };
  } catch (err) {
    return actionFailure(err);
  }
}
