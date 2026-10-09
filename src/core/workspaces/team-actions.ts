"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { isPermissionDeniedError } from "@/core/permissions/guard";
import { InsufficientRoleError } from "@/core/organizations/errors";
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
    return { error: "Dados inválidos para o convite." };
  }

  const { workspaceSlug, email, role } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(
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
    if (isPermissionDeniedError(err) || err instanceof InsufficientRoleError) {
      return { error: "Você não tem permissão para esta ação." };
    }
    const errorMsg =
      err instanceof Error ? err.message : "Erro ao gerar convite.";
    return { error: errorMsg };
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
    return { error: "Identificador de convite inválido." };
  }

  const { workspaceSlug, invitationId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(
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
    if (isPermissionDeniedError(err) || err instanceof InsufficientRoleError) {
      return { error: "Você não tem permissão para esta ação." };
    }
    const errorMsg =
      err instanceof Error ? err.message : "Erro ao revogar convite.";
    return { error: errorMsg };
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
    return { error: "Dados inválidos para alteração de papel." };
  }

  const { workspaceSlug, targetUserId, newRole } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(
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
    if (isPermissionDeniedError(err) || err instanceof InsufficientRoleError) {
      return { error: "Você não tem permissão para esta ação." };
    }
    const errorMsg =
      err instanceof Error ? err.message : "Erro ao atualizar papel do membro.";
    return { error: errorMsg };
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
    return { error: "Identificador de membro inválido." };
  }

  const { workspaceSlug, targetUserId } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(
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
    if (isPermissionDeniedError(err) || err instanceof InsufficientRoleError) {
      return { error: "Você não tem permissão para esta ação." };
    }
    const errorMsg =
      err instanceof Error ? err.message : "Erro ao remover membro.";
    return { error: errorMsg };
  }
}
