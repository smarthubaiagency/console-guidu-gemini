/**
 * ============================================================================
 * File: src/core/module-runtime/state.ts
 * Module: Module Access State (Especificação §14, Adendo §6 e §12)
 *
 * Maintenance Rationale:
 * - One function decides whether a module can be used in a workspace, and
 *   every entry point asks it: navigation, pages, server actions and services.
 *   Hiding a menu is not authorization (§14).
 * - Layers, in order: technical gate (environment) → global availability
 *   (admin) → release status (manifest) → workspace enablement → permission.
 * - Contracting (plans and entitlements) belongs to F3 and is not evaluated
 *   yet; manifests already declare their entitlements for that step.
 * ============================================================================
 */

import "server-only";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { ModuleUnavailableError } from "@/core/modules/availability";
import { getRegisteredModule, type RegisteredModule } from "@/modules/registry";

export type PlatformAvailability = "enabled" | "maintenance" | "disabled";
export type WorkspaceModuleStatus = "enabled" | "disabled";

export type PlatformModuleState = Readonly<{
  availability: PlatformAvailability;
  config: Record<string, unknown>;
}>;

export type WorkspaceModuleState = Readonly<{
  status: WorkspaceModuleStatus;
  config: Record<string, unknown>;
}>;

/**
 * - `hidden`: switched off in this environment or disabled by the platform.
 * - `coming_soon`: listed as a placeholder; no operation exists.
 * - `maintenance`: operations blocked with a clear message.
 * - `not_enabled`: available, but the workspace has not enabled it.
 * - `enabled`: operational, subject to permissions.
 */
export type ModuleAccessState =
  "hidden" | "coming_soon" | "maintenance" | "not_enabled" | "enabled";

const DEFAULT_PLATFORM_STATE: PlatformModuleState = {
  availability: "enabled",
  config: {},
};

const DEFAULT_WORKSPACE_STATE: WorkspaceModuleState = {
  status: "disabled",
  config: {},
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Pure decision used by every entry point. */
export function resolveModuleAccessState(
  mod: RegisteredModule,
  platform: PlatformModuleState = DEFAULT_PLATFORM_STATE,
  workspace: WorkspaceModuleState = DEFAULT_WORKSPACE_STATE,
): ModuleAccessState {
  if (!mod.technicalGate()) return "hidden";
  if (platform.availability === "disabled") return "hidden";
  if (mod.manifest.releaseStatus === "coming_soon") return "coming_soon";
  if (
    mod.manifest.releaseStatus === "maintenance" ||
    platform.availability === "maintenance"
  ) {
    return "maintenance";
  }
  if (workspace.status !== "enabled") return "not_enabled";
  return "enabled";
}

/** Global state of every module with a row; missing rows mean defaults. */
export async function loadPlatformModuleStates(
  tx: ContextTransaction,
): Promise<ReadonlyMap<string, PlatformModuleState>> {
  const rows = await tx.platformModule.findMany();
  return new Map(
    rows.map((row) => [
      row.moduleKey,
      {
        availability: row.availability as PlatformAvailability,
        config: asObject(row.config),
      },
    ]),
  );
}

/** Workspace state of the context workspace (RLS also scopes the rows). */
export async function loadWorkspaceModuleStates(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<ReadonlyMap<string, WorkspaceModuleState>> {
  const rows = await tx.workspaceModule.findMany({
    where: { workspaceId: ctx.workspaceId },
  });
  return new Map(
    rows.map((row) => [
      row.moduleKey,
      {
        status: row.status as WorkspaceModuleStatus,
        config: asObject(row.config),
      },
    ]),
  );
}

export async function getModuleAccessState(
  tx: ContextTransaction,
  ctx: RequestContext,
  moduleKey: string,
): Promise<ModuleAccessState> {
  const mod = getRegisteredModule(moduleKey);
  if (!mod) return "hidden";
  const [platform, workspace] = await Promise.all([
    tx.platformModule.findUnique({ where: { moduleKey } }),
    tx.workspaceModule.findFirst({
      where: { workspaceId: ctx.workspaceId, moduleKey },
    }),
  ]);
  return resolveModuleAccessState(
    mod,
    platform
      ? {
          availability: platform.availability as PlatformAvailability,
          config: asObject(platform.config),
        }
      : undefined,
    workspace
      ? {
          status: workspace.status as WorkspaceModuleStatus,
          config: asObject(workspace.config),
        }
      : undefined,
  );
}

/**
 * Throws unless the module is operational in the context workspace. Module
 * services call it before touching their data (Adendo §6).
 *
 * @throws {ModuleUnavailableError}
 */
export async function assertModuleOperational(
  tx: ContextTransaction,
  ctx: RequestContext,
  moduleKey: string,
): Promise<void> {
  const state = await getModuleAccessState(tx, ctx, moduleKey);
  if (state !== "enabled") {
    throw new ModuleUnavailableError(
      moduleKey,
      state === "maintenance"
        ? "Este módulo está em manutenção. Tente novamente mais tarde."
        : undefined,
    );
  }
}

/** Human label for a state, shared by navigation, dashboard and settings. */
export function moduleStateLabel(
  state: ModuleAccessState,
  releaseStatus: RegisteredModule["manifest"]["releaseStatus"],
): string {
  switch (state) {
    case "coming_soon":
      return "Em breve";
    case "maintenance":
      return "Manutenção";
    case "not_enabled":
      return "Desabilitado";
    case "enabled":
      return releaseStatus === "beta" ? "Beta" : "Ativo";
    default:
      return "Indisponível";
  }
}
