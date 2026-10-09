import "server-only";

import { assertModuleOperational } from "@/core/module-runtime/state";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type { ContextTransaction, RequestContext } from "@/lib/prisma/with-context";

import { __ModuleName__Permissions } from "../../manifest";

/**
 * Every service checks module state and permission before touching data,
 * even when a page already checked (Adendo §6). Queries filter by
 * ctx.workspaceId in addition to RLS.
 */
export async function list__ModuleName__Items(tx: ContextTransaction, ctx: RequestContext) {
  await assertModuleOperational(tx, ctx, "__MODULE_KEY__");
  await requireWorkspacePermission(tx, ctx, __ModuleName__Permissions.READ);
  // return tx.__moduleTable__.findMany({ where: { workspaceId: ctx.workspaceId } });
  return [];
}
