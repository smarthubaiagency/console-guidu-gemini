/**
 * ============================================================================
 * File: src/core/module-runtime/loaders.ts
 * Module: Server loaders for generated navigation and module views
 *
 * Maintenance Rationale:
 * - Reads role and module state inside the contextual transaction, so a
 *   revoked membership or a disabled module disappears on the next request.
 * - Returns plain DTOs for layouts and pages.
 * ============================================================================
 */

import "server-only";

import type { PrismaClient } from "@prisma/client";

import type { PermissionKey } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  type PartnerRoleKey,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { Permission } from "@/core/permissions/catalog";
import type { WorkspaceRole } from "@/core/permissions/roles";
import { type RequestContext, withContext } from "@/lib/prisma/with-context";
import {
  listRegisteredModules,
  type RegisteredModule,
} from "@/modules/registry";

import {
  buildPlatformNavigation,
  buildAppNavigation,
  type NavSection,
} from "./navigation";
import {
  loadPlatformModuleStates,
  loadWorkspaceModuleStates,
  moduleStateLabel,
  resolveModuleAccessState,
  type ModuleAccessState,
} from "./state";

export function workspaceGrants(role: WorkspaceRole | null) {
  return (permission: PermissionKey): boolean =>
    role !== null && workspaceRoleGrants(role, permission);
}

export function platformGrants(role: PlatformAdminRoleKey | null) {
  return (permission: PermissionKey): boolean =>
    role !== null && hasPlatformRolePermission(role, permission as Permission);
}

/** Grants of a partner role in the partner console (ADR 0012, D-PA-02). */
export function partnerGrants(role: PartnerRoleKey | null) {
  return (permission: PermissionKey): boolean =>
    role !== null && hasPartnerRolePermission(role, permission as Permission);
}

export async function loadAppNavigation(
  prisma: PrismaClient,
  context: RequestContext,
  workspaceSlug: string,
): Promise<NavSection[]> {
  return withContext(prisma, context, async (tx) => {
    const [role, platformStates, workspaceStates] = await Promise.all([
      getEffectiveWorkspaceRole(tx, context),
      loadPlatformModuleStates(tx),
      loadWorkspaceModuleStates(tx, context),
    ]);
    return buildAppNavigation({
      workspaceSlug,
      modules: listRegisteredModules(),
      platformStates,
      workspaceStates,
      grants: workspaceGrants(role),
    });
  });
}

export function loadPlatformNavigation(
  role: PlatformAdminRoleKey | null,
): NavSection[] {
  return buildPlatformNavigation({
    modules: listRegisteredModules(),
    grants: platformGrants(role),
  });
}

export type WorkspaceModuleView = Readonly<{
  moduleKey: string;
  displayName: string;
  description: string;
  iconKey: string | null;
  releaseStatus: RegisteredModule["manifest"]["releaseStatus"];
  state: ModuleAccessState;
  stateLabel: string;
  /** Path of the first app route, for the dashboard card. */
  href: string | null;
  canToggle: boolean;
  hasWorkspaceSettings: boolean;
}>;

/**
 * Modules visible to the context workspace, with their resolved state, for
 * the dashboard and the settings index (ADR 0005).
 */
export async function loadWorkspaceModuleViews(
  prisma: PrismaClient,
  context: RequestContext,
  workspaceSlug: string,
): Promise<{ modules: WorkspaceModuleView[]; canManage: boolean }> {
  return withContext(prisma, context, async (tx) => {
    const [role, platformStates, workspaceStates] = await Promise.all([
      getEffectiveWorkspaceRole(tx, context),
      loadPlatformModuleStates(tx),
      loadWorkspaceModuleStates(tx, context),
    ]);
    const canManage = workspaceGrants(role)("workspace.modules.manage");

    const modules = listRegisteredModules().flatMap(
      (mod): WorkspaceModuleView[] => {
        const key = mod.manifest.moduleKey;
        const state = resolveModuleAccessState(
          mod,
          platformStates.get(key),
          workspaceStates.get(key),
        );
        if (state === "hidden") return [];
        const firstRoute = mod.manifest.routes.find(
          (route) => route.destination === "app" && !route.path.includes("["),
        );
        return [
          {
            moduleKey: key,
            displayName: mod.manifest.displayName,
            description: mod.manifest.description,
            iconKey: mod.manifest.navigation[0]?.iconKey ?? null,
            releaseStatus: mod.manifest.releaseStatus,
            state,
            stateLabel: moduleStateLabel(state, mod.manifest.releaseStatus),
            href: firstRoute
              ? `/app/${workspaceSlug}/${firstRoute.path}`
              : null,
            canToggle:
              canManage &&
              (state === "enabled" ||
                state === "not_enabled" ||
                state === "maintenance"),
            hasWorkspaceSettings: mod.manifest.settings.some(
              (entry) => entry.destination === "workspace",
            ),
          },
        ];
      },
    );

    return { modules, canManage };
  });
}
