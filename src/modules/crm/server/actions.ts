"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError, type AppErrorCode } from "@/shared/errors";

import { createContact, updateContact } from "./services/contacts";

export type CrmActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
  contactId?: string;
};

const slug = z.string().min(1).max(64);

function contactFields(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    companyName: text("companyName"),
    jobTitle: text("jobTitle"),
    notes: text("notes"),
  };
}

async function contextFor(formData: FormData) {
  const workspaceSlug = slug.safeParse(formData.get("workspaceSlug"));
  if (!workspaceSlug.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Dados inválidos.",
      messageKey: "crm.errors.invalidInput",
    });
  }
  const identity = await requireUser();
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug.data,
  );
  return { context, workspaceSlug: workspaceSlug.data };
}

export async function createContactAction(
  _prev: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  try {
    const { context, workspaceSlug } = await contextFor(formData);
    const contact = await withContext(prisma, context, (tx) =>
      createContact(tx, context, contactFields(formData)),
    );
    revalidatePath(`/app/${workspaceSlug}/crm/contacts`);
    const t = await getTranslations("crm");
    return {
      success: true,
      message: t("actions.created"),
      contactId: contact.id,
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function updateContactAction(
  _prev: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  try {
    const { context, workspaceSlug } = await contextFor(formData);
    const contactId = z.string().uuid().parse(formData.get("contactId"));
    await withContext(prisma, context, (tx) =>
      updateContact(tx, context, contactId, contactFields(formData)),
    );
    revalidatePath(`/app/${workspaceSlug}/crm/contacts`, "layout");
    const t = await getTranslations("crm");
    return { success: true, message: t("actions.saved"), contactId };
  } catch (err) {
    return actionFailure(err);
  }
}
