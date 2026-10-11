"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { cancelWorkspaceDeletion, requestWorkspaceDeletion } from "./deletion";
import { requestWorkspaceExport } from "./export";

/** Server actions of "Dados e privacidade" and of /app (F3e). */

type State = PartnerActionState;

const failure = (err: unknown): Promise<State> => actionFailure(err);

const slug = z.string().min(1).max(64);

async function workspaceContext(formData: FormData) {
  const identity = await requireUser();
  const workspaceSlug = slug.parse(formData.get("workspaceSlug"));
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  return { identity, workspaceSlug, context };
}

export async function requestWorkspaceExportAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { identity, workspaceSlug, context } =
      await workspaceContext(formData);
    await withContext(prisma, context, (tx) =>
      requestWorkspaceExport(tx, context, {
        mfaVerified: identity.mfaSatisfied,
      }),
    );
    revalidatePath(`/app/${workspaceSlug}/settings/data`);
    return {
      success: true,
      message: (await getTranslations("privacy"))("exportRequested"),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function requestWorkspaceDeletionAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { identity, context } = await workspaceContext(formData);
    const confirmSlug = String(formData.get("confirmSlug") ?? "");
    await withContext(prisma, context, (tx) =>
      requestWorkspaceDeletion(
        tx,
        context,
        { confirmSlug },
        { mfaVerified: identity.mfaSatisfied },
      ),
    );
    return {
      success: true,
      message: (await getTranslations("privacy"))("deletionScheduled"),
      redirectTo: "/app?exclusao=agendada",
    };
  } catch (err) {
    return failure(err);
  }
}

export async function cancelWorkspaceDeletionAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireUser();
    const workspaceId = z.string().uuid().parse(formData.get("workspaceId"));
    const partner = await getRequestPartner();
    await withIdentityContext(
      prisma,
      identity.userId,
      (tx) =>
        cancelWorkspaceDeletion(tx, identity.userId, workspaceId, {
          mfaVerified: identity.mfaSatisfied,
        }),
      { partnerId: partner?.partnerId ?? null },
    );
    revalidatePath("/app");
    return {
      success: true,
      message: (await getTranslations("privacy"))("deletionCanceled"),
    };
  } catch (err) {
    return failure(err);
  }
}
