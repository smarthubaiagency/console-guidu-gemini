"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";

import { partnerHostOrigin } from "./hosts";
import {
  acceptPartnerInvitation,
  createPartnerInvitation,
  revokePartnerInvitation,
} from "./invitations";
import {
  addPartnerDomain,
  createPartner,
  setPartnerDomainStatus,
  setPartnerStatus,
} from "./management";
import { getPartnerMembership, updatePartnerMember } from "./members";
import { getRequestOrigin, getRequestPartner } from "./resolve";

export type PartnerActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
  inviteUrl?: string;
  redirectTo?: string;
};

function failure(err: unknown): PartnerActionState {
  const safe = toSafeError(err);
  return {
    error: safe.safeMessage,
    code: safe.code,
    requestId: safe.requestId,
  };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

const uuid = z.string().uuid();

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
  });
}

/** Platform console actor: AAL2, platform host and active internal role. */
async function platformActor() {
  const identity = await requireMfa();
  const partner = await getRequestPartner();
  if (!partner?.isPlatformHost) throw notFound();
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    userId: identity.userId,
    role: admin?.status === "active" ? admin.role : null,
  };
}

/** Partner console actor: AAL2 and an active role in the host's partner. */
async function partnerActor() {
  const identity = await requireMfa();
  const partner = await getRequestPartner();
  if (!partner) throw notFound();
  const membership = await getPartnerMembership(
    prisma,
    identity.userId,
    partner.partnerId,
  );
  return {
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership?.role ?? null,
  };
}

// ---------------------------------------------------------------------------
// Platform console (/platform/partners)
// ---------------------------------------------------------------------------

export async function createPartnerAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await platformActor();
    const { id } = await withIdentityContext(prisma, actor.userId, (tx) =>
      createPartner(tx, actor, {
        name: text(formData, "name"),
        slug: text(formData, "slug"),
      }),
    );
    revalidatePath("/platform/partners");
    return {
      success: true,
      message: "Parceiro criado.",
      redirectTo: `/platform/partners/${id}`,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function setPartnerStatusAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await platformActor();
    const partnerId = uuid.parse(text(formData, "partnerId"));
    const status = z
      .enum(["active", "suspended"])
      .parse(text(formData, "status"));
    await withIdentityContext(prisma, actor.userId, (tx) =>
      setPartnerStatus(tx, actor, partnerId, status),
    );
    revalidatePath(`/platform/partners/${partnerId}`);
    return {
      success: true,
      message:
        status === "active" ? "Parceiro reativado." : "Parceiro suspenso.",
    };
  } catch (err) {
    return failure(err);
  }
}

export async function addPartnerDomainAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await platformActor();
    const partnerId = uuid.parse(text(formData, "partnerId"));
    const kind = z.enum(["subdomain", "custom"]).parse(text(formData, "kind"));
    await withIdentityContext(prisma, actor.userId, (tx) =>
      addPartnerDomain(tx, actor, partnerId, {
        host: text(formData, "host"),
        kind,
      }),
    );
    revalidatePath(`/platform/partners/${partnerId}`);
    return { success: true, message: "Domínio cadastrado como pendente." };
  } catch (err) {
    return failure(err);
  }
}

export async function setPartnerDomainStatusAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await platformActor();
    const partnerId = uuid.parse(text(formData, "partnerId"));
    const status = z
      .enum(["active", "disabled"])
      .parse(text(formData, "status"));
    await withIdentityContext(prisma, actor.userId, (tx) =>
      setPartnerDomainStatus(tx, actor, text(formData, "host"), status),
    );
    revalidatePath(`/platform/partners/${partnerId}`);
    return {
      success: true,
      message: status === "active" ? "Domínio ativado." : "Domínio desativado.",
    };
  } catch (err) {
    return failure(err);
  }
}

/**
 * Invitation created from the platform. The link points to an active domain
 * of the partner when there is one, otherwise to the platform host.
 */
export async function invitePartnerMemberFromPlatformAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await platformActor();
    const partnerId = uuid.parse(text(formData, "partnerId"));
    const result = await withIdentityContext(
      prisma,
      actor.userId,
      async (tx) => {
        const domain = await tx.partnerDomain.findFirst({
          where: { partnerId, status: "active" },
          orderBy: { createdAt: "asc" },
          select: { host: true },
        });
        const origin = domain
          ? partnerHostOrigin(domain.host, process.env)
          : ((await getRequestOrigin()) ?? "");
        return createPartnerInvitation(
          tx,
          { userId: actor.userId, platformRole: actor.role, partnerRole: null },
          partnerId,
          { email: text(formData, "email"), role: text(formData, "role") },
          origin,
        );
      },
    );
    revalidatePath(`/platform/partners/${partnerId}`);
    return {
      success: true,
      message: "Convite gerado.",
      inviteUrl: result.inviteUrl,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function revokePartnerInvitationFromPlatformAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await platformActor();
    const partnerId = uuid.parse(text(formData, "partnerId"));
    const invitationId = uuid.parse(text(formData, "invitationId"));
    await withIdentityContext(prisma, actor.userId, (tx) =>
      revokePartnerInvitation(
        tx,
        { userId: actor.userId, platformRole: actor.role, partnerRole: null },
        invitationId,
      ),
    );
    revalidatePath(`/platform/partners/${partnerId}`);
    return { success: true, message: "Convite revogado." };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------
// Partner console (/admin)
// ---------------------------------------------------------------------------

export async function invitePartnerMemberAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await partnerActor();
    const origin = (await getRequestOrigin()) ?? "";
    const result = await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        createPartnerInvitation(
          tx,
          {
            userId: actor.userId,
            platformRole: null,
            partnerRole: actor.partnerRole,
          },
          actor.partnerId,
          { email: text(formData, "email"), role: text(formData, "role") },
          origin,
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/admin/members");
    return {
      success: true,
      message: "Convite gerado.",
      inviteUrl: result.inviteUrl,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function revokePartnerInvitationAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await partnerActor();
    const invitationId = uuid.parse(text(formData, "invitationId"));
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        revokePartnerInvitation(
          tx,
          {
            userId: actor.userId,
            platformRole: null,
            partnerRole: actor.partnerRole,
          },
          invitationId,
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/admin/members");
    return { success: true, message: "Convite revogado." };
  } catch (err) {
    return failure(err);
  }
}

export async function updatePartnerMemberAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const actor = await partnerActor();
    const userId = uuid.parse(text(formData, "userId"));
    const role = text(formData, "role") || undefined;
    const statusRaw = text(formData, "status");
    const status = statusRaw
      ? z.enum(["active", "inactive"]).parse(statusRaw)
      : undefined;
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        updatePartnerMember(
          tx,
          { userId: actor.userId, partnerRole: actor.partnerRole },
          actor.partnerId,
          userId,
          { ...(role ? { role } : {}), ...(status ? { status } : {}) },
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/admin/members");
    return { success: true, message: "Membro atualizado." };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------
// Invitation acceptance (/partner-invite/[token])
// ---------------------------------------------------------------------------

export async function acceptPartnerInvitationAction(
  _prev: PartnerActionState,
  formData: FormData,
): Promise<PartnerActionState> {
  try {
    const identity = await requireUser();
    const token = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(text(formData, "token"));
    const { partnerId } = await acceptPartnerInvitation(
      prisma,
      identity,
      token,
    );
    const host = await getRequestPartner();
    return {
      success: true,
      message: "Convite aceito.",
      ...(host?.partnerId === partnerId ? { redirectTo: "/admin" } : {}),
    };
  } catch (err) {
    return failure(err);
  }
}
