import "server-only";

import { z } from "zod";

import { Permissions } from "@/core/permissions/catalog";
import {
  hasPartnerRolePermission,
  type PartnerRoleKey,
} from "@/core/permissions/matrix";
import type { PrismaClient } from "@prisma/client";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { type ProposalView, toView } from "./service";

/**
 * The /admin queue of proposals (H4, ADR 0020): the proposals of the
 * companies the partner manages (`gerenciado`), where its owner, admin and
 * support decide and the customer only follows. The list reads in the
 * partner's identity context (RLS: `private.partner_manages_organization`);
 * a decision runs in the context of the proposal's workspace, as the
 * partner, through the same `approveProposal`/`rejectProposal` of F4d.
 */

export type PartnerActor = Readonly<{
  userId: string;
  partnerId: string;
  partnerRole: PartnerRoleKey | null;
}>;

export type PartnerProposalRow = ProposalView &
  Readonly<{ organizationName: string; workspaceName: string }>;

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Proposta não encontrada.",
    messageKey: "proposals.errors.notFound",
  });
}

export function partnerMayReview(role: PartnerRoleKey | null): boolean {
  return Boolean(
    role &&
    hasPartnerRolePermission(role, Permissions.PARTNER_PROPOSALS_REVIEW),
  );
}

/** The proposals of the managed companies, newest first (RLS cuts). */
export async function listPartnerProposals(
  tx: ContextTransaction,
  actor: PartnerActor,
  take = 100,
): Promise<PartnerProposalRow[]> {
  if (!partnerMayReview(actor.partnerRole)) return [];
  const rows = await tx.executionProposal.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
  const workspaceIds = [...new Set(rows.map((row) => row.workspaceId))];
  const [workspaces, organizations] = await Promise.all([
    tx.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true, name: true },
    }),
    tx.organization.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } },
      select: { id: true, name: true },
    }),
  ]);
  const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));
  const organizationName = new Map(organizations.map((o) => [o.id, o.name]));
  const ctx = {
    userId: actor.userId,
    workspaceId: "",
    organizationId: "",
  } as RequestContext;
  return rows.map((row) => ({
    ...toView(row, ctx),
    organizationName: organizationName.get(row.organizationId) ?? "",
    workspaceName: workspaceName.get(row.workspaceId) ?? "",
  }));
}

/**
 * The context of a proposal's workspace for the partner, or not found
 * when the partner does not manage its company (now).
 */
export async function partnerProposalContext(
  prisma: PrismaClient,
  actor: PartnerActor,
  proposalId: string,
): Promise<RequestContext> {
  if (
    !partnerMayReview(actor.partnerRole) ||
    !z.uuid().safeParse(proposalId).success
  ) {
    throw notFound();
  }
  const row = await withIdentityContext(
    prisma,
    actor.userId,
    (tx) =>
      tx.executionProposal.findFirst({
        where: { id: proposalId },
        select: { workspaceId: true, organizationId: true },
      }),
    { partnerId: actor.partnerId },
  );
  if (!row) throw notFound();
  const ctx: RequestContext = {
    userId: actor.userId,
    workspaceId: row.workspaceId,
    organizationId: row.organizationId,
    partnerId: actor.partnerId,
    principalType: "user",
  };
  const manages = await withContext(prisma, ctx, async (tx) => {
    const [result] = await tx.$queryRaw<{ ok: boolean }[]>`
      select private.partner_manages_organization(${ctx.organizationId}::uuid) as ok
    `;
    return result?.ok === true;
  });
  if (!manages) throw notFound();
  return ctx;
}
