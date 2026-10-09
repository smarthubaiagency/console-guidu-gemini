/**
 * Server-side access decision for module pages (Especificação §14): pages
 * resolve the module state and permissions themselves; hiding the menu is not
 * the protection.
 */
import "server-only";

import type { PermissionKey } from "@/core/permissions/catalog";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { workspaceGrants } from "./loaders";
import { getModuleAccessState } from "./state";

export type ModulePageAccess =
  | { kind: "missing" }
  | { kind: "maintenance" }
  | { kind: "not_enabled" }
  | { kind: "denied" }
  | { kind: "ok"; can: (permission: PermissionKey) => boolean };

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
  if (!can(readPermission)) return { kind: "denied" };
  if (state === "maintenance") return { kind: "maintenance" };
  if (state === "not_enabled") return { kind: "not_enabled" };
  return { kind: "ok", can };
}
