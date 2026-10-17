import "server-only";

import { getModuleAccessState } from "@/core/module-runtime/state";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  type PartnerRoleKey,
} from "@/core/permissions/matrix";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { type RequestContext, withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { GoogleBusinessPermissions } from "../manifest";
import { gbNotFound } from "./errors";
import {
  readServiceMode,
  type ServiceMode,
} from "@/core/organizations/service-mode";
import type { GbTarget } from "./target";
import {
  type GbActorKind,
  managerKind,
  partnerManages,
  requireManager,
  requireReader,
} from "./actors";

export {
  type GbActorKind,
  managerKind,
  partnerManages,
  requireManager,
  requireReader,
};

/**
 * Who may do what with the fichas of a workspace (GB1a, ADR 0020):
 *
 * - `/app`: members read; owner and admin operate while the company is in
 *   `padrao` mode and the module is enabled for the workspace. In
 *   `gerenciado` mode the customer follows (read only).
 * - `/admin`: the partner's owner, admin and support operate the workspaces
 *   of the companies it manages (`private.partner_manages_organization`).
 *
 * Every page and action resolves this again on the server; RLS repeats it.
 */

export type GbAccess = Readonly<{
  target: GbTarget;
  ctx: RequestContext;
  actor: GbActorKind;
  mode: ServiceMode;
  canManage: boolean;
  workspaceName: string;
}>;

export function gbModuleAvailable(): boolean {
  return isModuleTechnicallyAvailable("google-business");
}

export async function resolveAppAccess(
  userId: string,
  workspaceSlug: string,
): Promise<GbAccess> {
  if (!gbModuleAvailable()) throw gbNotFound();
  const ctx = await resolveRequestWorkspaceContext(
    prisma,
    userId,
    workspaceSlug,
  );
  return withContext(prisma, ctx, async (tx) => {
    const [role, mode, state, workspace] = await Promise.all([
      getEffectiveWorkspaceRole(tx, ctx),
      readServiceMode(tx, ctx.organizationId),
      getModuleAccessState(tx, ctx, "google-business"),
      tx.workspace.findFirst({
        where: { id: ctx.workspaceId },
        select: { name: true },
      }),
    ]);
    // Members that read the module (the Attendant, AT1, does not).
    if (!role || !workspaceRoleGrants(role, GoogleBusinessPermissions.READ)) {
      throw gbNotFound();
    }
    return {
      target: { scope: "app", workspaceSlug },
      ctx,
      actor: "member" as const,
      mode,
      canManage:
        (role === "owner" || role === "admin") &&
        mode === "padrao" &&
        state === "enabled",
      workspaceName: workspace?.name ?? workspaceSlug,
    };
  });
}

export type PartnerActorInput = Readonly<{
  userId: string;
  partnerId: string;
  partnerRole: PartnerRoleKey | null;
}>;

export function partnerMayOperate(role: PartnerRoleKey | null): boolean {
  return Boolean(
    role &&
    hasPartnerRolePermission(role, Permissions.PARTNER_GOOGLE_BUSINESS_MANAGE),
  );
}

export async function resolveAdminAccess(
  actor: PartnerActorInput,
  workspaceId: string,
): Promise<GbAccess> {
  if (!gbModuleAvailable() || !partnerMayOperate(actor.partnerRole)) {
    throw gbNotFound();
  }
  const workspace = await withIdentityContext(
    prisma,
    actor.userId,
    (tx) =>
      tx.workspace.findFirst({
        where: { id: workspaceId, status: "active" },
        select: { id: true, organizationId: true, name: true },
      }),
    { partnerId: actor.partnerId },
  );
  if (!workspace) throw gbNotFound();
  const ctx: RequestContext = {
    userId: actor.userId,
    workspaceId: workspace.id,
    organizationId: workspace.organizationId,
    partnerId: actor.partnerId,
    principalType: "user",
  };
  const manages = await withContext(prisma, ctx, (tx) =>
    partnerManages(tx, ctx),
  );
  if (!manages) throw gbNotFound();
  return {
    target: { scope: "admin", workspaceId: workspace.id },
    ctx,
    actor: "partner",
    mode: "gerenciado",
    canManage: true,
    workspaceName: workspace.name,
  };
}
