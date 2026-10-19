import "server-only";

import { recordAudit } from "@/core/audit/record";
import type { ContactLocale } from "@/core/matrix/locale";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import type { InboxViewer } from "./access";

/**
 * The contact's language, corrected by who answers (TR1,
 * docs/modules/inbox/traducao.md). A manual language is never changed by a
 * later detection; the GUIDS answers in it from the next turn. The
 * database checks the same (policy `matrix_rooms_contact_locale`).
 */
export async function setContactLocale(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  input: Readonly<{ roomId: string; locale: ContactLocale }>,
): Promise<void> {
  if (viewer.level !== "reply") {
    throw new AppError({
      code: "forbidden",
      safeMessage: "Você não tem permissão para esta ação.",
      messageKey: "errors.permissionDenied",
    });
  }
  const { count } = await tx.matrixRoom.updateMany({
    where: {
      roomId: input.roomId,
      workspaceId: ctx.workspaceId,
      state: "active",
    },
    data: {
      contactLocale: input.locale,
      contactLocaleSource: "manual",
      contactLocaleConfidence: null,
    },
  });
  if (count === 0) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Conversa não encontrada.",
      messageKey: "inbox.errors.conversationNotFound",
    });
  }
  await recordAudit(tx, ctx, {
    action: "inbox.contact_locale.set",
    resourceType: "matrix_room",
    resourceId: input.roomId,
    result: "success",
    origin: "app",
    metadata: { locale: input.locale },
  });
}
