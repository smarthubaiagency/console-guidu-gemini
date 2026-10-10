"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { toSafeError } from "@/shared/errors";

import { cancelWorkspaceDeletion, requestWorkspaceDeletion } from "./deletion";
import { requestWorkspaceExport } from "./export";

/** Server actions of "Dados e privacidade" and of /app (F3e). */

type State = PartnerActionState;

function failure(err: unknown): State {
  const safe = toSafeError(err);
  return {
    error: safe.safeMessage,
    code: safe.code,
    requestId: safe.requestId,
  };
}

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
      message:
        "Exportação pedida. Ela fica pronta em alguns minutos e aparece aqui por 24 horas.",
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
      message: "Exclusão agendada. Você pode cancelar em até 30 dias.",
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
      message: "Exclusão cancelada. O workspace voltou.",
    };
  } catch (err) {
    return failure(err);
  }
}
