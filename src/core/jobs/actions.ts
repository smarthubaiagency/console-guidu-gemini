"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

import { retryJobRun } from "./service";

/** Puts a failed run back in the queue (Executions page, owner/admin). */
export async function retryJobRunAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const identity = await requireUser();
    const workspaceSlug = z
      .string()
      .min(1)
      .parse(formData.get("workspaceSlug"));
    const jobRunId = z.string().uuid().parse(formData.get("jobRunId"));
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    await withContext(prisma, context, (tx) =>
      retryJobRun(tx, context, jobRunId),
    );
    revalidatePath(`/app/${workspaceSlug}/executions`);
    const t = await getTranslations("executions");
    return { success: true, message: t("retried") };
  } catch (err) {
    return actionFailure(err);
  }
}
