import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import type { Identity } from "@/core/auth/identity";
import { adminAuditContext } from "@/core/module-runtime/settings";
import {
  generateInvitationToken,
  hashInvitationToken,
} from "@/core/organizations/invitations";
import {
  PARTNER_ROLES,
  type PartnerRoleKey,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { PrismaClient } from "@prisma/client";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { invalidPartnerInput, partnerNotFound } from "./errors";

/** Partner invitations (ADR 0012, P4a): the only way to join a partner. */

export const PARTNER_INVITATION_TTL_HOURS = 72;

export type InvitingActor = Readonly<{
  userId: string;
  platformRole: PlatformAdminRoleKey | null;
  partnerRole: PartnerRoleKey | null;
}>;

const InvitationInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Informe um e-mail válido.")
    .max(254),
  role: z.enum(PARTNER_ROLES as [PartnerRoleKey, ...PartnerRoleKey[]]),
});

function canInvite(actor: InvitingActor): boolean {
  return (
    actor.platformRole === "owner" ||
    actor.platformRole === "operations" ||
    actor.partnerRole === "partner_owner"
  );
}

/**
 * Creates an invitation for `partnerId`. Platform owner/operations may invite
 * to any partner; a partner_owner only to the context partner (RLS).
 */
export async function createPartnerInvitation(
  tx: ContextTransaction,
  actor: InvitingActor,
  partnerId: string,
  input: Readonly<{ email: string; role: string }>,
  origin: string,
): Promise<{ id: string; rawToken: string; inviteUrl: string }> {
  if (!canInvite(actor)) throw new PermissionDeniedError();
  const parsed = InvitationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidPartnerInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }

  const partner = await tx.partner.findUnique({
    where: { id: partnerId },
    select: { id: true },
  });
  if (!partner) throw partnerNotFound();

  const { rawToken, tokenHash } = generateInvitationToken();
  const invitation = await tx.partnerInvitation.create({
    data: {
      partnerId,
      email: parsed.data.email,
      role: parsed.data.role,
      tokenHash,
      status: "pending",
      expiresAt: new Date(
        Date.now() + PARTNER_INVITATION_TTL_HOURS * 3600 * 1000,
      ),
      invitedBy: actor.userId,
    },
    select: { id: true },
  });

  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.invitation.create",
    resourceType: "partner_invitation",
    resourceId: invitation.id,
    result: "success",
    origin: actor.platformRole ? "admin" : "app",
    metadata: {
      role: parsed.data.role,
      emailDomain: parsed.data.email.split("@")[1] ?? "unknown",
      target: partnerId,
    },
  });

  return {
    id: invitation.id,
    rawToken,
    inviteUrl: `${origin}/partner-invite/${rawToken}`,
  };
}

export async function revokePartnerInvitation(
  tx: ContextTransaction,
  actor: InvitingActor,
  invitationId: string,
): Promise<void> {
  if (!canInvite(actor)) throw new PermissionDeniedError();
  const invitation = await tx.partnerInvitation.findUnique({
    where: { id: invitationId },
  });
  if (!invitation) throw partnerNotFound();
  if (invitation.status !== "pending") return;

  await tx.partnerInvitation.update({
    where: { id: invitationId },
    data: { status: "revoked" },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.invitation.revoke",
    resourceType: "partner_invitation",
    resourceId: invitationId,
    result: "success",
    origin: actor.platformRole ? "admin" : "app",
    metadata: { target: invitation.partnerId },
  });
}

export type PartnerInvitationView =
  | Readonly<{
      status: "valid";
      partnerId: string;
      partnerName: string;
      role: PartnerRoleKey;
    }>
  | Readonly<{
      status:
        | "not_found"
        | "accepted"
        | "revoked"
        | "expired"
        | "recipient_mismatch"
        | "email_unconfirmed";
    }>;

async function withInvitationContext<T>(
  prisma: PrismaClient,
  identity: Identity,
  rawToken: string,
  operation: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  const tokenHash = hashInvitationToken(rawToken);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      select
        set_config('app.user_id', ${identity.userId}, true),
        set_config('app.principal_type', 'user', true),
        set_config('app.partner_invitation_token_hash', ${tokenHash}, true)
    `;
    return operation(tx);
  });
}

function sameEmail(identity: Identity, email: string): boolean {
  return identity.email?.trim().toLowerCase() === email;
}

/** State of an invitation for the signed-in identity, without changing it. */
export async function getPartnerInvitationView(
  prisma: PrismaClient,
  identity: Identity,
  rawToken: string,
): Promise<PartnerInvitationView> {
  return withInvitationContext(prisma, identity, rawToken, async (tx) => {
    const invitation = await tx.partnerInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(rawToken) },
    });
    if (!invitation) return { status: "not_found" };
    if (invitation.status === "accepted") return { status: "accepted" };
    if (invitation.status === "revoked") return { status: "revoked" };
    if (invitation.status === "expired" || invitation.expiresAt <= new Date()) {
      return { status: "expired" };
    }
    if (!sameEmail(identity, invitation.email)) {
      return { status: "recipient_mismatch" };
    }
    if (!identity.emailConfirmedAt) return { status: "email_unconfirmed" };

    // The partner name is resolved in the partner context of the invitation.
    await tx.$executeRaw`select set_config('app.partner_id', ${invitation.partnerId}, true)`;
    const partner = await tx.partner.findUnique({
      where: { id: invitation.partnerId },
      select: { name: true },
    });
    return {
      status: "valid",
      partnerId: invitation.partnerId,
      partnerName: partner?.name ?? "Parceiro",
      role: invitation.role as PartnerRoleKey,
    };
  });
}

/** Accepts an invitation for the signed-in identity (confirmed e-mail). */
export async function acceptPartnerInvitation(
  prisma: PrismaClient,
  identity: Identity,
  rawToken: string,
): Promise<{ partnerId: string }> {
  return withInvitationContext(prisma, identity, rawToken, async (tx) => {
    const invitation = await tx.partnerInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(rawToken) },
    });
    if (!invitation) throw partnerNotFound();
    if (invitation.status !== "pending" || invitation.expiresAt <= new Date()) {
      throw new AppError({
        code: "conflict",
        safeMessage: "Este convite não está mais disponível.",
      });
    }
    if (!sameEmail(identity, invitation.email)) {
      throw new AppError({
        code: "forbidden",
        safeMessage: "Este convite foi enviado para outro e-mail.",
      });
    }
    if (!identity.emailConfirmedAt) {
      throw new AppError({
        code: "forbidden",
        safeMessage:
          "O seu e-mail precisa estar confirmado para aceitar o convite.",
      });
    }

    await tx.partnerMember.upsert({
      where: {
        partnerId_userId: {
          partnerId: invitation.partnerId,
          userId: identity.userId,
        },
      },
      create: {
        partnerId: invitation.partnerId,
        userId: identity.userId,
        email: invitation.email,
        role: invitation.role,
        status: "active",
      },
      update: {
        role: invitation.role,
        status: "active",
        email: invitation.email,
      },
    });
    await tx.partnerInvitation.update({
      where: { id: invitation.id },
      data: { status: "accepted", acceptedBy: identity.userId },
    });

    await recordAudit(tx, adminAuditContext(identity.userId), {
      action: "partner.member.join",
      resourceType: "partner_member",
      resourceId: invitation.partnerId,
      result: "success",
      origin: "app",
      metadata: { role: invitation.role, target: invitation.partnerId },
    });
    return { partnerId: invitation.partnerId };
  });
}
