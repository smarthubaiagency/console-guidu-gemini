/**
 * ============================================================================
 * File: src/core/workspaces/team-actions.ts
 * Module: Workspace & Organization Team Management Server Actions (C07 & C10)
 *
 * Maintenance Rationale:
 * - Server actions bridge between team administration UI and domain services.
 * - All mutations execute securely within `withContext` (ADR 0001).
 * - Enforces permission checks and safe error contracts in the request
 *   language via `actionFailure` (I2).
 * ============================================================================
 */

"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { emailInvitation } from "@/core/email/invitations";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { actionFailure } from "@/core/i18n/errors";
import { AppError, type AppErrorCode } from "@/shared/errors";
import {
  createInvitation,
  revokeInvitation,
} from "@/core/organizations/invitations";
import { removeOrganizationMember } from "@/core/organizations/members";
import { changeTeamMemberRole } from "@/core/workspaces/members";
import { setAttendantMark } from "@/modules/inbox/server/attendants";

export type ActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  rawToken?: string;
  inviteUrl?: string;
  code?: AppErrorCode;
  requestId?: string;
};

const InviteInput = z.object({
  workspaceSlug: z.string().min(1),
  email: z.string().email().trim(),
  // "attendant" (AT1) is a workspace role: the invitation targets this
  // workspace and its acceptance makes the person a company member.
  role: z.enum(["owner", "admin", "member", "attendant"]),
});

export async function createInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = InviteInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para o convite.",
        messageKey: "team.errors.invalidInvitationInput",
      }),
    );
  }

  const { workspaceSlug, email, role } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    const origin = (await getRequestOrigin()) ?? undefined;
    const { result, organizationName } = await withContext(
      prisma,
      context,
      async (tx) => ({
        organizationName:
          (
            await tx.organization.findUnique({
              where: { id: context.organizationId },
              select: { name: true },
            })
          )?.name ?? "",
        result: await createInvitation(tx, {
          organizationId: context.organizationId,
          actorId: identity.userId,
          email,
          role,
          workspaceId: context.workspaceId,
          ...(origin ? { origin } : {}),
        }),
      }),
    );

    revalidatePath(`/app/${workspaceSlug}/settings/team`);
    const emailed = await emailInvitation({
      email: result.invitation.email,
      organizationName,
      expiresAt: result.invitation.expiresAt,
      inviteUrl: result.inviteUrl,
    });

    return {
      success: true,
      message: (await getTranslations("team"))(
        emailed ? "invitationEmailed" : "invitationCreated",
        { email },
      ),
      rawToken: result.rawToken,
      inviteUrl: result.inviteUrl,
    };
  } catch (err: unknown) {
    return actionFailure(err);
  }
}

const RevokeInput = z.object({
  workspaceSlug: z.string().min(1),
  invitationId: z.string().uuid(),
});

export async function revokeInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RevokeInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    invitationId: formData.get("invitationId"),
  });

  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Identificador de convite inválido.",
        messageKey: "team.errors.invalidInvitationId",
      }),
    );
  }

  const { workspaceSlug, invitationId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    await withContext(prisma, context, async (tx) => {
      return revokeInvitation(tx, {
        organizationId: context.organizationId,
        actorId: identity.userId,
        invitationId,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/settings/team`);

    return {
      success: true,
      message: (await getTranslations("team"))("invitationRevoked"),
    };
  } catch (err: unknown) {
    return actionFailure(err);
  }
}

const UpdateRoleInput = z.object({
  workspaceSlug: z.string().min(1),
  targetUserId: z.string().uuid(),
  newRole: z.enum(["owner", "admin", "member", "attendant"]),
});

export async function updateMemberRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = UpdateRoleInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    targetUserId: formData.get("targetUserId"),
    newRole: formData.get("newRole"),
  });

  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para alteração de papel.",
        messageKey: "team.errors.invalidRoleInput",
      }),
    );
  }

  const { workspaceSlug, targetUserId, newRole } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    await withContext(prisma, context, (tx) =>
      changeTeamMemberRole(tx, {
        workspaceId: context.workspaceId,
        organizationId: context.organizationId,
        actorId: identity.userId,
        targetUserId,
        choice: newRole,
      }),
    );

    revalidatePath(`/app/${workspaceSlug}/settings/team`);

    return {
      success: true,
      message: (await getTranslations("team"))("roleUpdated"),
    };
  } catch (err: unknown) {
    return actionFailure(err);
  }
}

const RemoveMemberInput = z.object({
  workspaceSlug: z.string().min(1),
  targetUserId: z.string().uuid(),
});

export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RemoveMemberInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    targetUserId: formData.get("targetUserId"),
  });

  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Identificador de membro inválido.",
        messageKey: "team.errors.invalidMemberId",
      }),
    );
  }

  const { workspaceSlug, targetUserId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    await withContext(prisma, context, async (tx) => {
      return removeOrganizationMember(tx, {
        organizationId: context.organizationId,
        actorId: identity.userId,
        targetUserId,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/settings/team`);

    return {
      success: true,
      message: (await getTranslations("team"))("memberRemoved"),
    };
  } catch (err: unknown) {
    return actionFailure(err);
  }
}

const AttendantMarkInput = z.object({
  workspaceSlug: z.string().min(1),
  targetUserId: z.string().uuid(),
  marked: z.enum(["true", "false"]),
});

/** Marks or unmarks a member as attendant of the Inbox (IN4a). */
export async function setAttendantMarkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = AttendantMarkInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    targetUserId: formData.get("targetUserId"),
    marked: formData.get("marked"),
  });
  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para alteração de papel.",
        messageKey: "team.errors.invalidRoleInput",
      }),
    );
  }
  const { workspaceSlug, targetUserId } = parsed.data;
  const marked = parsed.data.marked === "true";
  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    await withContext(prisma, context, (tx) =>
      setAttendantMark(tx, context, { userId: targetUserId, marked }),
    );
    revalidatePath(`/app/${workspaceSlug}/settings/team`);
    return {
      success: true,
      message: (await getTranslations("team"))(
        marked ? "attendantMarked" : "attendantUnmarked",
      ),
    };
  } catch (err: unknown) {
    return actionFailure(err);
  }
}
