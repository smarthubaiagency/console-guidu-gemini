import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import {
  PermissionDeniedError,
  requireWorkspacePermission,
} from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  type PartnerRoleKey,
} from "@/core/permissions/matrix";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { invalidPartnerInput, partnerNotFound } from "./errors";

/**
 * Temporary support access (ADR 0012, P4b2; especificação §12).
 *
 * A partner member asks for access to a customer with a reason and a
 * duration. An owner or admin of a customer workspace approves it in that
 * workspace, which creates a `viewer` membership linked to the grant. The
 * SQL membership helpers and the application guard accept that membership
 * only while the grant is approved and unexpired, so expiry and revocation
 * take effect on the next request without any job.
 */

export const MAX_SUPPORT_HOURS = 72;

export type SupportGrantView = Readonly<{
  id: string;
  organizationId: string;
  workspaceSlug: string | null;
  granteeEmail: string;
  reason: string;
  durationHours: number;
  status: "pending" | "approved" | "denied" | "revoked";
  /** True while approved and unexpired. */
  active: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  decidedAt: Date | null;
}>;

type GrantRow = {
  id: string;
  organizationId: string;
  workspaceSlug: string | null;
  granteeEmail: string;
  reason: string;
  durationHours: number;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  decidedAt: Date | null;
};

function toView(row: GrantRow, now = new Date()): SupportGrantView {
  const status = row.status as SupportGrantView["status"];
  return {
    ...row,
    status,
    active:
      status === "approved" && Boolean(row.expiresAt && row.expiresAt > now),
  };
}

const GRANT_SELECT = {
  id: true,
  organizationId: true,
  workspaceSlug: true,
  granteeEmail: true,
  reason: true,
  durationHours: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  decidedAt: true,
} as const;

// ---------------------------------------------------------------------------
// Partner side (partner context)
// ---------------------------------------------------------------------------

export type SupportRequester = Readonly<{
  userId: string;
  partnerRole: PartnerRoleKey | null;
}>;

const RequestSchema = z.object({
  organizationId: z.string().uuid("Escolha o cliente."),
  reason: z
    .string()
    .trim()
    .min(10, "Explique o motivo em pelo menos 10 caracteres.")
    .max(500),
  durationHours: z.coerce
    .number()
    .int()
    .min(1, "Prazo mínimo de 1 hora.")
    .max(MAX_SUPPORT_HOURS, `Prazo máximo de ${MAX_SUPPORT_HOURS} horas.`),
});

export async function requestSupportAccess(
  tx: ContextTransaction,
  actor: SupportRequester,
  partnerId: string,
  input: Readonly<{
    organizationId: string;
    reason: string;
    durationHours: number | string;
  }>,
): Promise<{ id: string }> {
  if (
    !actor.partnerRole ||
    !hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_SUPPORT_REQUEST,
    )
  ) {
    throw new PermissionDeniedError();
  }
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidPartnerInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }

  const [member, organization] = await Promise.all([
    tx.partnerMember.findUnique({
      where: { partnerId_userId: { partnerId, userId: actor.userId } },
      select: { email: true },
    }),
    tx.organization.findFirst({
      where: { id: parsed.data.organizationId, partnerId },
      select: { id: true },
    }),
  ]);
  if (!member || !organization) throw partnerNotFound();

  const open = await tx.partnerSupportGrant.findFirst({
    where: {
      partnerId,
      organizationId: organization.id,
      granteeUserId: actor.userId,
      OR: [
        { status: "pending" },
        { status: "approved", expiresAt: { gt: new Date() } },
      ],
    },
    select: { id: true },
  });
  if (open) {
    throw new AppError({
      code: "conflict",
      safeMessage:
        "Você já tem um pedido aberto ou um acesso vigente para esse cliente.",
    });
  }

  const grant = await tx.partnerSupportGrant.create({
    data: {
      partnerId,
      organizationId: organization.id,
      granteeUserId: actor.userId,
      granteeEmail: member.email,
      requestedBy: actor.userId,
      reason: parsed.data.reason,
      durationHours: parsed.data.durationHours,
      status: "pending",
    },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.support.request",
    resourceType: "partner_support_grant",
    resourceId: grant.id,
    result: "success",
    origin: "app",
    metadata: {
      target: organization.id,
      to: `${parsed.data.durationHours}h`,
    },
  });
  return grant;
}

export async function listPartnerSupportGrants(
  tx: ContextTransaction,
  partnerId: string,
): Promise<SupportGrantView[]> {
  const rows = await tx.partnerSupportGrant.findMany({
    where: { partnerId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: GRANT_SELECT,
  });
  return rows.map((row) => toView(row));
}

/** The requester withdraws a pending request or ends an approved grant. */
export async function endOwnSupportGrant(
  tx: ContextTransaction,
  actor: Readonly<{ userId: string }>,
  partnerId: string,
  grantId: string,
): Promise<void> {
  const grant = await tx.partnerSupportGrant.findFirst({
    where: { id: grantId, partnerId, requestedBy: actor.userId },
    select: { id: true, status: true, organizationId: true },
  });
  if (!grant) throw partnerNotFound();
  if (grant.status !== "pending" && grant.status !== "approved") return;

  await tx.partnerSupportGrant.update({
    where: { id: grantId },
    data: { status: "revoked" },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.support.end",
    resourceType: "partner_support_grant",
    resourceId: grantId,
    result: "success",
    origin: "app",
    metadata: {
      target: grant.organizationId,
      from: grant.status,
      to: "revoked",
    },
  });
}

// ---------------------------------------------------------------------------
// Customer side (workspace context)
// ---------------------------------------------------------------------------

export async function listWorkspaceSupportGrants(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<SupportGrantView[]> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_MEMBERS_MANAGE,
  );
  const rows = await tx.partnerSupportGrant.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: GRANT_SELECT,
  });
  return rows.map((row) => toView(row));
}

/**
 * Approves or denies a pending request in the contextual workspace. Approval
 * gives the grantee a `viewer` membership valid until the grant expires.
 */
export async function decideSupportGrant(
  tx: ContextTransaction,
  ctx: RequestContext,
  grantId: string,
  decision: "approve" | "deny",
): Promise<void> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_MEMBERS_MANAGE,
  );
  const grant = await tx.partnerSupportGrant.findFirst({
    where: { id: grantId, organizationId: ctx.organizationId },
  });
  if (!grant) throw partnerNotFound();
  if (grant.status !== "pending") {
    throw new AppError({
      code: "conflict",
      safeMessage: "Esse pedido já foi decidido.",
    });
  }

  const now = new Date();
  if (decision === "deny") {
    await tx.partnerSupportGrant.update({
      where: { id: grantId },
      data: { status: "denied", decidedBy: ctx.userId, decidedAt: now },
    });
  } else {
    const existing = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: ctx.workspaceId,
          userId: grant.granteeUserId,
        },
      },
      select: { supportGrantId: true },
    });
    if (existing && !existing.supportGrantId) {
      throw new AppError({
        code: "conflict",
        safeMessage: "Essa pessoa já é membro deste workspace.",
      });
    }
    const workspace = await tx.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { slug: true },
    });
    const expiresAt = new Date(
      now.getTime() + grant.durationHours * 3600 * 1000,
    );

    await tx.partnerSupportGrant.update({
      where: { id: grantId },
      data: {
        status: "approved",
        workspaceId: ctx.workspaceId,
        workspaceSlug: workspace?.slug ?? null,
        expiresAt,
        decidedBy: ctx.userId,
        decidedAt: now,
      },
    });
    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: ctx.workspaceId,
          userId: grant.granteeUserId,
        },
      },
      create: {
        workspaceId: ctx.workspaceId,
        organizationId: ctx.organizationId,
        userId: grant.granteeUserId,
        role: "viewer",
        status: "active",
        supportGrantId: grantId,
      },
      update: { role: "viewer", status: "active", supportGrantId: grantId },
    });
  }

  await recordAudit(tx, ctx, {
    action:
      decision === "approve"
        ? "partner.support.approve"
        : "partner.support.deny",
    resourceType: "partner_support_grant",
    resourceId: grantId,
    result: "success",
    origin: "app",
    metadata: {
      emailDomain: grant.granteeEmail.split("@")[1] ?? "unknown",
      to: decision === "approve" ? `${grant.durationHours}h` : "denied",
    },
  });
}

/** Ends an approved grant now; the support membership is deactivated. */
export async function revokeSupportGrant(
  tx: ContextTransaction,
  ctx: RequestContext,
  grantId: string,
): Promise<void> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_MEMBERS_MANAGE,
  );
  const grant = await tx.partnerSupportGrant.findFirst({
    where: { id: grantId, organizationId: ctx.organizationId },
    select: { id: true, status: true, workspaceId: true, granteeUserId: true },
  });
  if (!grant) throw partnerNotFound();
  if (grant.status !== "approved") return;

  await tx.partnerSupportGrant.update({
    where: { id: grantId },
    data: { status: "revoked", decidedBy: ctx.userId, decidedAt: new Date() },
  });
  if (grant.workspaceId === ctx.workspaceId) {
    await tx.workspaceMember.updateMany({
      where: {
        workspaceId: ctx.workspaceId,
        userId: grant.granteeUserId,
        supportGrantId: grantId,
      },
      data: { status: "inactive" },
    });
  }
  await recordAudit(tx, ctx, {
    action: "partner.support.revoke",
    resourceType: "partner_support_grant",
    resourceId: grantId,
    result: "success",
    origin: "app",
    metadata: { from: "approved", to: "revoked" },
  });
}
