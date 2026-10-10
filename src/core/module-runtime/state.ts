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
 * - Contracting (F3b): the company's plan contract comes after maintenance.
 *   A module outside the plan, or a canceled subscription, is
 *   `not_contracted`; a suspended subscription leaves the module
 *   `suspended`, readable but not writable. Without a subscription (legacy)
 *   nothing changes.
 * ============================================================================
 */

import "server-only";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import {
  type CompanyContract,
  LEGACY_CONTRACT,
  loadCompanyContract,
} from "@/core/entitlements/contract";
import {
  moduleContractAccess,
  type ModuleContractAccess,
} from "@/core/entitlements/rules";
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
 * - `not_contracted`: outside the company's plan, or subscription canceled.
 * - `not_enabled`: available, but the workspace has not enabled it.
 * - `suspended`: subscription suspended; read only.
 * - `enabled`: operational, subject to permissions.
 */
export type ModuleAccessState =
  | "hidden"
  | "coming_soon"
  | "maintenance"
  | "not_contracted"
  | "not_enabled"
  | "suspended"
  | "enabled";

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
  contract: ModuleContractAccess = "full",
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
  if (contract === "blocked") return "not_contracted";
  if (workspace.status !== "enabled") return "not_enabled";
  if (contract === "read_only") return "suspended";
  return "enabled";
}

/** Contract access of every registered module, for lists and navigation. */
export function contractAccessFor(
  contract: CompanyContract,
  moduleKey: string,
): ModuleContractAccess {
  return moduleContractAccess(contract, moduleKey);
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
  const [platform, workspace, contract] = await Promise.all([
    tx.platformModule.findUnique({ where: { moduleKey } }),
    tx.workspaceModule.findFirst({
      where: { workspaceId: ctx.workspaceId, moduleKey },
    }),
    ctx.organizationId
      ? loadCompanyContract(tx, ctx.organizationId)
      : Promise.resolve(LEGACY_CONTRACT),
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
    moduleContractAccess(contract, moduleKey),
  );
}

/**
 * Throws unless the module can be used in the context workspace. Module
 * services call it before touching their data (Adendo §6): `read` for
 * queries (allowed while the subscription is suspended), `write` for
 * anything that creates or changes data.
 *
 * @throws {ModuleUnavailableError}
 */
export async function assertModuleOperational(
  tx: ContextTransaction,
  ctx: RequestContext,
  moduleKey: string,
  mode: "read" | "write" = "write",
): Promise<void> {
  const state = await getModuleAccessState(tx, ctx, moduleKey);
  if (state === "enabled" || (mode === "read" && state === "suspended")) return;
  const error = new ModuleUnavailableError(
    moduleKey,
    unavailableMessage(state),
  );
  if (
    state === "maintenance" ||
    state === "not_contracted" ||
    state === "suspended" ||
    state === "not_enabled"
  ) {
    error.reason = state;
  }
  throw error;
}

function unavailableMessage(state: ModuleAccessState): string | undefined {
  switch (state) {
    case "maintenance":
      return "Este módulo está em manutenção. Tente novamente mais tarde.";
    case "not_contracted":
      return "O plano da sua empresa não inclui este módulo.";
    case "suspended":
      return "A assinatura está suspensa: o módulo está disponível só para consulta.";
    default:
      return undefined;
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
    case "not_contracted":
      return "Não contratado";
    case "suspended":
      return "Só leitura";
    case "enabled":
      return releaseStatus === "beta" ? "Beta" : "Ativo";
    default:
      return "Indisponível";
  }
}
