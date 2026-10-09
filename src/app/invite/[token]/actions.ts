"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma/client";
import { requireUser } from "@/core/auth/identity";
import { acceptInvitation } from "@/core/organizations/invitations";
import { type AppErrorCode, toSafeError } from "@/shared/errors";

export type AcceptInvitationState = {
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
};

export async function acceptInvitationAction(
  rawToken: string,
): Promise<AcceptInvitationState> {
  const identity = await requireUser();
  let targetPath = "/app";

  try {
    const result = await acceptInvitation(prisma, {
      rawToken,
      identity,
    });

    if (result.workspaceSlug) {
      targetPath = `/app/${result.workspaceSlug}`;
    }
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  redirect(targetPath);
}
