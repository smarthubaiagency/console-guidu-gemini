/**
 * Server-side access decision for module pages (Especificação §14): pages
 * resolve the module state and permissions themselves; hiding the menu is not
 * the protection.
 */
import "server-only";

import { notFound } from "next/navigation";

import { Permissions, type PermissionKey } from "@/core/permissions/catalog";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { prisma } from "@/lib/prisma/client";
import {
  withContext,
  type ContextTransaction,
  type RequestContext,
} from "@/lib/prisma/with-context";

import { workspaceGrants } from "./loaders";
import { getModuleAccessState } from "./state";

export type ModulePageAccess =
  | { kind: "missing" }
  | { kind: "maintenance" }
  | { kind: "not_enabled" }
  | { kind: "not_contracted" }
  | { kind: "denied" }
  | {
      kind: "ok";
      can: (permission: PermissionKey) => boolean;
      /** Subscription suspended: the page shows data but offers no writes. */
      readOnly: boolean;
    };

/**
 * Whether the role opens the workspace areas beyond the dashboard (settings,
 * executions, proposals and modules): they all need `workspace.read`. The
 * Attendant (AT1) does not hold it and enters only the dashboard and, from
 * IN4, the Inbox.
 */
export async function canOpenWorkspaceAreas(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<boolean> {
  return workspaceGrants(await getEffectiveWorkspaceRole(tx, ctx))(
    Permissions.WORKSPACE_READ,
  );
}

/**
 * Page guard of those areas: a role without `workspace.read` gets the same
 * 404 as someone outside the workspace. Each page calls it, not only the
 * layout, because a layout is not re-rendered on every navigation.
 */
export async function requireWorkspaceAreaPage(
  ctx: RequestContext,
): Promise<void> {
  const allowed = await withContext(prisma, ctx, (tx) =>
    canOpenWorkspaceAreas(tx, ctx),
  );
  if (!allowed) notFound();
}

export async function resolveModulePageAccess(
  tx: ContextTransaction,
  ctx: RequestContext,
  moduleKey: string,
  readPermission: PermissionKey,
): Promise<ModulePageAccess> {
  const [state, role] = await Promise.all([
    getModuleAccessState(tx, ctx, moduleKey),
    getEffectiveWorkspaceRole(tx, ctx),
  ]);
  if (state === "hidden" || state === "coming_soon") return { kind: "missing" };
  const can = workspaceGrants(role);
  if (!can(readPermission)) {
    // Outside the workspace areas (the Attendant, AT1) the module does not
    // exist; inside, the page explains the missing permission.
    return can(Permissions.WORKSPACE_READ)
      ? { kind: "denied" }
      : { kind: "missing" };
  }
  if (state === "maintenance") return { kind: "maintenance" };
  if (state === "not_contracted") return { kind: "not_contracted" };
  if (state === "not_enabled") return { kind: "not_enabled" };
  if (state === "suspended") {
    // Only read permissions remain while suspended.
    return {
      kind: "ok",
      can: (p) => p === readPermission && can(p),
      readOnly: true,
    };
  }
  return { kind: "ok", can, readOnly: false };
}
