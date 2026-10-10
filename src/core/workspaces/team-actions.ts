/**
 * ============================================================================
 * File: src/core/workspaces/team-actions.ts
 * Module: Workspace & Organization Team Management Server Actions (C07 & C10)
 *
 * Maintenance Rationale:
 * - Server actions bridge between team administration UI and domain services.
 * - All mutations execute securely within `withContext` (ADR 0001).
 * - Enforces permission checks and safe standardized error contracts via `toSafeError`.
 * ============================================================================
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";
import {
  createInvitation,
  revokeInvitation,
} from "@/core/organizations/invitations";
import {
  updateOrganizationMemberRole,
  removeOrganizationMember,
} from "@/core/organizations/members";
import type { OrganizationRole } from "@/core/permissions/roles";

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
  role: z.enum(["owner", "admin", "member"]),
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
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para o convite.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  const { workspaceSlug, email, role } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    const result = await withContext(prisma, context, async (tx) => {
      return createInvitation(tx, {
        organizationId: context.organizationId,
        actorId: identity.userId,
        email,
        role: role as OrganizationRole,
        workspaceId: context.workspaceId,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/settings/team`);

    return {
      success: true,
      message: `Convite gerado para ${email}.`,
      rawToken: result.rawToken,
      inviteUrl: result.inviteUrl,
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
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
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Identificador de convite inválido.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
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
      message: "Convite revogado com sucesso.",
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }
}

const UpdateRoleInput = z.object({
  workspaceSlug: z.string().min(1),
  targetUserId: z.string().uuid(),
  newRole: z.enum(["owner", "admin", "member"]),
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
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Dados inválidos para alteração de papel.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  const { workspaceSlug, targetUserId, newRole } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );

    await withContext(prisma, context, async (tx) => {
      return updateOrganizationMemberRole(tx, {
        organizationId: context.organizationId,
        actorId: identity.userId,
        targetUserId,
        newRole: newRole as OrganizationRole,
      });
    });

    revalidatePath(`/app/${workspaceSlug}/settings/team`);

    return {
      success: true,
      message: "Papel do membro atualizado com sucesso.",
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
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
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: "Identificador de membro inválido.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
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
      message: "Membro removido da organização com sucesso.",
    };
  } catch (err: unknown) {
    const safe = toSafeError(err);
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }
}
