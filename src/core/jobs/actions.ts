"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { toSafeError } from "@/shared/errors";

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
    return { success: true, message: "Execução enviada de novo para a fila." };
  } catch (err) {
    const safe = toSafeError(err);
    return {
      error: safe.safeMessage,
      code: safe.code,
      requestId: safe.requestId,
    };
  }
}
