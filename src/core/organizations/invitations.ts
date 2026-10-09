/**
 * ============================================================================
 * File: src/core/organizations/invitations.ts
 * Module: Organization & Workspace Invitations Lifecycle Service
 *
 * Maintenance Rationale:
 * - Implements AC06:
 *   1. Generates cryptographically secure, high-entropy tokens whose raw values
 *      are never persisted in plaintext (only SHA-256 token_hash is stored).
 *   2. Enforces explicit expirations (default 48 hours).
 *   3. Enforces organization seat quotas atomically under concurrency using
 *      PostgreSQL transaction advisory locks (pg_advisory_xact_lock).
 *      No race condition can cause an organization to exceed its seat quota.
 * - Respects ADR 0001: Data mutations execute inside contextual transactions
 *   with transaction-local RLS variables.
 * ============================================================================
 */

import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { ContextTransaction, RequestContext } from "@/lib/prisma/with-context";
import {
  canAssignOrganizationRole,
  canAssignWorkspaceRole,
  isOrganizationRole,
  isWorkspaceRole,
  OrganizationRole,
  OrganizationRoles,
  WorkspaceRole,
} from "../permissions/roles";
import { Permissions } from "../permissions/catalog";
import {
  requireOrganizationPermission,
  requireWorkspacePermission,
} from "../permissions/guard";
import { recordAudit } from "../audit/record";
import { appConfig } from "../config/app";
import type { Identity } from "../auth/identity";
import {
  InsufficientRoleError,
  InvitationAlreadyAcceptedError,
  InvitationEmailUnconfirmedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRecipientMismatchError,
  InvitationRevokedError,
  SeatLimitExceededError,
} from "./errors";

export type InvitationItem = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  email: string;
  role: string;
  tokenHash: string;
  invitedByUserId: string;
  status: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Computes the deterministic SHA-256 hex digest of a raw invitation token.
 */
export function hashInvitationToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Generates a high-entropy 256-bit random token and its corresponding SHA-256 hash.
 */
export function generateInvitationToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashInvitationToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Creates an expirable invitation with strict seat quota validation (AC06).
 *
 * Concurrency Safety:
 * Uses `pg_advisory_xact_lock(hashtext('org_seats:' || org_id))` to serialize
 * seat allocation within the transaction. If active members + pending invites
 * reach maxSeats, creation is refused.
 */
export async function createInvitation(
  tx: ContextTransaction,
  params: {
    organizationId: string;
    actorId: string;
    email: string;
    role: OrganizationRole | WorkspaceRole;
    workspaceId?: string | null;
    expiresInHours?: number;
  },
): Promise<{ invitation: InvitationItem; rawToken: string; inviteUrl: string }> {
  const {
    organizationId,
    actorId,
    email: rawEmail,
    role,
    workspaceId = null,
    expiresInHours = 48,
  } = params;

  const email = rawEmail.trim().toLowerCase();

  // 1. Acquire transaction advisory lock for this organization's seat allocation
  await tx.$executeRaw`
    select pg_advisory_xact_lock(hashtext('org_seats:' || ${organizationId}::text))
  `;

  // 2. Validate actor permissions via guard and escalation rules (AC04 boundary)
  if (!workspaceId) {
    const { organizationRole } = await requireOrganizationPermission(
      tx,
      { userId: actorId, organizationId, workspaceId: "" },
      Permissions.ORGANIZATION_MEMBERS_INVITE,
    );

    if (
      !canAssignOrganizationRole(organizationRole, role as OrganizationRole)
    ) {
      throw new InsufficientRoleError("invite_organization_member", role);
    }
  } else {
    const { workspaceRole, organizationRole } = await requireWorkspacePermission(
      tx,
      { userId: actorId, workspaceId, organizationId },
      Permissions.WORKSPACE_MEMBERS_INVITE,
    );

    if (
      !canAssignWorkspaceRole(
        organizationRole ?? undefined,
        workspaceRole,
        role as WorkspaceRole,
      )
    ) {
      throw new InsufficientRoleError("invite_workspace_member", role);
    }
  }

  // 4. Verify Organization Seat Quota (AC06)
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
  });

  const maxSeats = org?.maxSeats ?? 5;

  const [activeMembersCount, pendingInvitesCount] = await Promise.all([
    tx.organizationMember.count({
      where: { organizationId, status: "active" },
    }),
    tx.invitation.count({
      where: {
        organizationId,
        status: "pending",
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  const totalCommittedSeats = activeMembersCount + pendingInvitesCount;
  if (totalCommittedSeats >= maxSeats) {
    throw new SeatLimitExceededError(organizationId, maxSeats, totalCommittedSeats);
  }

  // 5. Expire or revoke any previous pending invitation for this exact email & target
  await tx.invitation.updateMany({
    where: {
      organizationId,
      email,
      workspaceId,
      status: "pending",
    },
    data: {
      status: "revoked",
    },
  });

  // 6. Generate cryptographic token and persist invitation
  const { rawToken, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  const invitation = await tx.invitation.create({
    data: {
      organizationId,
      workspaceId,
      email,
      role,
      tokenHash,
      invitedByUserId: actorId,
      status: "pending",
      expiresAt,
    },
  });

  const emailDomain = email.includes("@") ? email.split("@")[1] : "unknown";
  await recordAudit(
    tx,
    {
      userId: actorId,
      organizationId,
      workspaceId: workspaceId ?? "",
    },
    {
      action: "invitations.created",
      resourceType: "invitation",
      resourceId: invitation.id,
      result: "success",
      origin: "app",
      metadata: {
        role: invitation.role,
        emailDomain,
        target: workspaceId ? "workspace" : "organization",
      },
    },
  );

  const inviteUrl = `${appConfig.url}/invite/${rawToken}`;
  return { invitation, rawToken, inviteUrl };
}

/**
 * Lists all invitations for an organization.
 * When ctx is provided, requires `organization.members.invite` permission.
 */
export async function listInvitations(
  tx: ContextTransaction,
  ctxOrOrgId: RequestContext | string,
): Promise<InvitationItem[]> {
  if (typeof ctxOrOrgId === "object") {
    await requireOrganizationPermission(
      tx,
      ctxOrOrgId,
      Permissions.ORGANIZATION_MEMBERS_INVITE,
    );
    return tx.invitation.findMany({
      where: { organizationId: ctxOrOrgId.organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  return tx.invitation.findMany({
    where: { organizationId: ctxOrOrgId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Revokes a pending invitation.
 */
export async function revokeInvitation(
  tx: ContextTransaction,
  params: {
    organizationId: string;
    actorId: string;
    invitationId: string;
  },
): Promise<InvitationItem> {
  const { organizationId, actorId, invitationId } = params;

  // Verify actor has organization member manage privilege via guard
  await requireOrganizationPermission(
    tx,
    { userId: actorId, organizationId, workspaceId: "" },
    Permissions.ORGANIZATION_MEMBERS_MANAGE,
  );

  const revoked = await tx.invitation.update({
    where: { id: invitationId },
    data: { status: "revoked" },
  });

  await recordAudit(
    tx,
    {
      userId: actorId,
      organizationId,
      workspaceId: "",
    },
    {
      action: "invitations.revoked",
      resourceType: "invitation",
      resourceId: invitationId,
      result: "success",
      origin: "app",
    },
  );

  return revoked;
}

/**
 * Atomically accepts an invitation under strict concurrency control (AC06).
 *
 * Guarantees:
 * 1. Validates verified recipient identity matching invitation email.
 * 2. Requires confirmed email address on the identity.
 * 3. Token lookup via SHA-256 hash.
 * 4. Expiration check with automatic status transition to 'expired'.
 * 5. Advisory lock on the organization prevents seat oversubscription.
 * 6. Automatic membership creation in organization and/or workspace.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  params: {
    rawToken: string;
    identity: Identity;
  },
): Promise<{
  invitation: InvitationItem;
  organizationId: string;
  workspaceId: string | null;
  workspaceSlug?: string | null;
}> {
  const { rawToken, identity } = params;

  // 1. Require confirmed email address (Specification §8)
  if (!identity.emailConfirmedAt) {
    throw new InvitationEmailUnconfirmedError();
  }

  const tokenHash = hashInvitationToken(rawToken);

  return prisma.$transaction(
    async (tx) => {
      // 2. Establish initial identity & invitation context for RLS
      await tx.$executeRaw`
        select
          set_config('app.user_id', ${identity.userId}, true),
          set_config('app.invitation_token_hash', ${tokenHash}, true)
      `;

      // 3. Query invitation by token hash
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
      });

      if (!invitation) {
        throw new InvitationNotFoundError();
      }

      // 4. Strict recipient verification: invitation email must match identity email (Specification §8)
      if (
        !identity.email ||
        identity.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()
      ) {
        throw new InvitationRecipientMismatchError();
      }

      const { organizationId, workspaceId } = invitation;

      // 5. Set organization and optional workspace context in RLS immediately
      await tx.$executeRaw`
        select
          set_config('app.organization_id', ${organizationId}, true),
          set_config('app.workspace_id', ${workspaceId ?? ""}, true)
      `;

      if (invitation.status === "accepted") {
        throw new InvitationAlreadyAcceptedError();
      }

      if (invitation.status === "revoked") {
        throw new InvitationRevokedError();
      }

      // Check expiration
      if (invitation.status === "expired" || invitation.expiresAt <= new Date()) {
        if (invitation.status !== "expired") {
          await tx.invitation.update({
            where: { id: invitation.id },
            data: { status: "expired" },
          });
        }
        throw new InvitationExpiredError();
      }

      // 6. Serialize seat capacity using Postgres transaction advisory lock (AC06)
      await tx.$executeRaw`
        select pg_advisory_xact_lock(hashtext('org_seats:' || ${organizationId}::text))
      `;

      // 7. Check if user is already an active member of this organization
      const existingOrgMember = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: identity.userId,
          },
        },
      });

      if (!existingOrgMember) {
        // Add user as organization member
        const assignedOrgRole = isOrganizationRole(invitation.role)
          ? (invitation.role as OrganizationRole)
          : OrganizationRoles.MEMBER;

        await tx.organizationMember.create({
          data: {
            organizationId,
            userId: identity.userId,
            role: assignedOrgRole,
            status: "active",
          },
        });

        // Now that the user is an active member, RLS allows counting all active members
        const org = await tx.organization.findUnique({
          where: { id: organizationId },
        });
        const maxSeats = org?.maxSeats ?? 5;

        const activeCount = await tx.organizationMember.count({
          where: { organizationId, status: "active" },
        });

        if (activeCount > maxSeats) {
          throw new SeatLimitExceededError(organizationId, maxSeats, activeCount);
        }
      }

      // 8. If invitation target is a specific workspace, attach membership
      let workspaceSlug: string | null = null;
      if (workspaceId) {
        const assignedWsRole = isWorkspaceRole(invitation.role)
          ? (invitation.role as WorkspaceRole)
          : "viewer";

        await tx.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId,
              userId: identity.userId,
            },
          },
          update: {
            role: assignedWsRole,
            status: "active",
          },
          create: {
            workspaceId,
            organizationId,
            userId: identity.userId,
            role: assignedWsRole,
            status: "active",
          },
        });

        const ws = await tx.workspace.findUnique({
          where: { id: workspaceId },
          select: { slug: true },
        });
        workspaceSlug = ws?.slug ?? null;
      }

      // 9. Mark invitation as accepted
      const acceptedInvitation = await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: "accepted",
          acceptedAt: new Date(),
          acceptedByUserId: identity.userId,
        },
      });

      await recordAudit(
        tx,
        {
          userId: identity.userId,
          organizationId,
          workspaceId: workspaceId ?? "",
        },
        {
          action: "invitations.accepted",
          resourceType: "invitation",
          resourceId: invitation.id,
          result: "success",
          origin: "app",
          metadata: {
            role: invitation.role,
          },
        },
      );

      return {
        invitation: acceptedInvitation,
        organizationId,
        workspaceId,
        workspaceSlug,
      };
    },
    { maxWait: 30_000, timeout: 30_000 },
  );
}

export type InvitationDetails = {
  status:
    | "valid"
    | "expired"
    | "revoked"
    | "already_accepted"
    | "recipient_mismatch"
    | "email_unconfirmed"
    | "not_found";
  organizationName?: string;
  workspaceName?: string | null;
  role?: string;
  errorMessage?: string;
};

/**
 * Reads invitation details for the /invite/[token] route using RLS context.
 * Uses policy `organizations_select_by_invitation` with `app.invitation_token_hash`.
 * Never logs or reveals the invitation token or target email to a mismatched visitor.
 */
export async function getInvitationDetails(
  prisma: PrismaClient,
  rawToken: string,
  identity: Identity,
): Promise<InvitationDetails> {
  const tokenHash = hashInvitationToken(rawToken);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      select
        set_config('app.user_id', ${identity.userId}, true),
        set_config('app.invitation_token_hash', ${tokenHash}, true)
    `;

    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
    });

    if (!invitation) {
      return {
        status: "not_found",
        errorMessage: "Convite não encontrado ou inválido.",
      };
    }

    if (invitation.status === "accepted") {
      return {
        status: "already_accepted",
        errorMessage: "Este convite já foi aceito.",
      };
    }

    if (invitation.status === "revoked") {
      return {
        status: "revoked",
        errorMessage: "Este convite foi revogado por um administrador.",
      };
    }

    if (invitation.status === "expired" || invitation.expiresAt <= new Date()) {
      return {
        status: "expired",
        errorMessage: "Este convite expirou.",
      };
    }

    if (
      !identity.email ||
      identity.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()
    ) {
      return {
        status: "recipient_mismatch",
        errorMessage: "Este convite foi enviado para outro e-mail.",
      };
    }

    if (!identity.emailConfirmedAt) {
      return {
        status: "email_unconfirmed",
        errorMessage: "O seu e-mail precisa estar confirmado para aceitar o convite.",
      };
    }

    const org = await tx.organization.findUnique({
      where: { id: invitation.organizationId },
      select: { name: true },
    });

    let workspaceName: string | null = null;
    if (invitation.workspaceId) {
      const ws = await tx.workspace.findUnique({
        where: { id: invitation.workspaceId },
        select: { name: true },
      });
      workspaceName = ws?.name ?? null;
    }

    return {
      status: "valid",
      organizationName: org?.name ?? "Organização",
      workspaceName,
      role: invitation.role,
    };
  });
}

