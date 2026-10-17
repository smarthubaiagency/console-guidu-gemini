import "server-only";

import {
  getEffectiveWorkspaceRole,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import { readServiceMode } from "@/core/organizations/service-mode";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { GoogleBusinessPermissions } from "../manifest";
import { gbForbidden, gbNotFound } from "./errors";

/**
 * Who reads and who operates the fichas of a context (ADR 0020), without the
 * request helpers of `access.ts`: safe for the worker, which runs the
 * analyses of the GB1b with the same rules.
 */

export type GbActorKind = "member" | "partner";

/** True when the partner of the context manages the context's company. */
export async function partnerManages(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<boolean> {
  if (!ctx.partnerId) return false;
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    select private.partner_manages_organization(${ctx.organizationId}::uuid) as ok
  `;
  return row?.ok === true;
}

/**
 * Who operates in this context, checked inside the transaction of each
 * write: the managing partner, or owner/admin of the workspace in `padrao`
 * mode. Null: read only.
 */
export async function managerKind(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<GbActorKind | null> {
  const role = await getEffectiveWorkspaceRole(tx, ctx);
  if (role === "owner" || role === "admin") {
    const mode = await readServiceMode(tx, ctx.organizationId);
    return mode === "padrao" ? "member" : null;
  }
  if (role) return null;
  return (await partnerManages(tx, ctx)) ? "partner" : null;
}

export async function requireManager(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<GbActorKind> {
  const kind = await managerKind(tx, ctx);
  if (!kind) throw gbForbidden();
  return kind;
}

/** Readers: members of the workspace or the managing partner. */
export async function requireReader(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<void> {
  const role = await getEffectiveWorkspaceRole(tx, ctx);
  if (role) {
    // Members that read the module; the Attendant (AT1) does not.
    if (workspaceRoleGrants(role, GoogleBusinessPermissions.READ)) return;
    throw gbNotFound();
  }
  if (await partnerManages(tx, ctx)) return;
  throw gbNotFound();
}
