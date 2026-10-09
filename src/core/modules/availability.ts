import "server-only";

import { getRegisteredModule, type ModuleKey } from "@/modules/registry";

/** Kept for existing callers; the source of truth is the module registry. */
export type PlatformModuleKey = ModuleKey;

/**
 * Error thrown when an operation targets a module that is not available in
 * the current environment or workspace.
 */
export class ModuleUnavailableError extends Error {
  readonly moduleKey: string;

  constructor(moduleKey: string, message?: string) {
    super(
      message ??
        `O módulo '${moduleKey}' está temporariamente indisponível nesta etapa da plataforma.`,
    );
    this.name = "ModuleUnavailableError";
    this.moduleKey = moduleKey;
  }
}

/**
 * Technical availability in this environment, without database state: the
 * module is registered, its technical gate is open and its release status is
 * not `coming_soon`.
 *
 * Global availability, workspace enablement and permissions are evaluated by
 * `src/core/module-runtime/state.ts`, which every module page and service of
 * the F2 contract uses. The frozen Agentes de IA module (C04) still relies
 * only on this check and its GUIDU_MODULE_AI_AGENTS_ENABLED flag.
 */
export function isModuleTechnicallyAvailable(
  moduleKey: PlatformModuleKey,
): boolean {
  const mod = getRegisteredModule(moduleKey);
  if (!mod) return false;
  return mod.technicalGate() && mod.manifest.releaseStatus !== "coming_soon";
}

/**
 * Asserts that a module is technically available, throwing ModuleUnavailableError otherwise.
 */
export function assertModuleAvailable(moduleKey: PlatformModuleKey): void {
  if (!isModuleTechnicallyAvailable(moduleKey)) {
    throw new ModuleUnavailableError(moduleKey);
  }
}
