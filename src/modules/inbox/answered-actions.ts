"use server";

import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { Permissions } from "@/core/permissions/catalog";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { loadInboxViewer } from "./server/access";
import {
  type AnsweredByDto,
  loadAnsweredBy,
  MAX_ANSWER_EVENTS,
} from "./server/answered-by";

/**
 * Server action of the mark "Respondido pelo …" (GF2): the roles of the
 * specialists that wrote the answers in view. It resolves the workspace, the
 * module and the person's level in the Inbox again.
 */

const ReadInput = z.object({
  workspaceSlug: z.string().min(1).max(120),
  roomId: z.string().regex(/^![^\s]{1,254}$/),
  eventIds: z.array(z.string().min(2).max(255)).max(MAX_ANSWER_EVENTS),
});

export async function loadAnsweredByAction(
  input: z.input<typeof ReadInput>,
): Promise<{ answers: AnsweredByDto[] } | { error: string }> {
  try {
    const data = ReadInput.parse(input);
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      data.workspaceSlug,
    );
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
      return {
        answers: await loadAnsweredBy(tx, context, {
          roomId: data.roomId,
          eventIds: data.eventIds,
        }),
      };
    });
  } catch (error) {
    return actionFailure(error);
  }
}
