import "server-only";

export type PlatformModuleKey = "catalog" | "google-business" | "ai-agents";

/**
 * Error thrown when an operation targets a platform module that is not
 * technically available in the current environment.
 */
export class ModuleUnavailableError extends Error {
  readonly moduleKey: PlatformModuleKey;

  constructor(moduleKey: PlatformModuleKey, message?: string) {
    super(
      message ??
        `O módulo '${moduleKey}' está temporariamente indisponível nesta etapa da plataforma.`,
    );
    this.name = "ModuleUnavailableError";
    this.moduleKey = moduleKey;
  }
}

/**
 * Checks whether a platform module is technically available in the current runtime environment.
 *
 * NOTE: This mechanism is provisional and will be replaced by the formal module manifest
 * and registration contract in Phase 2 (ADR 0006). Do NOT introduce a full module manifest
 * or module registry at this stage.
 *
 * Availability rules:
 * - "ai-agents": Controlled by GUIDU_MODULE_AI_AGENTS_ENABLED === "true"; disabled by default.
 * - "catalog": Disabled (returns false).
 * - "google-business": Disabled (returns false).
 */
export function isModuleTechnicallyAvailable(
  moduleKey: PlatformModuleKey,
): boolean {
  switch (moduleKey) {
    case "ai-agents":
      return process.env.GUIDU_MODULE_AI_AGENTS_ENABLED === "true";
    case "catalog":
    case "google-business":
      return false;
    default:
      return false;
  }
}

/**
 * Asserts that a platform module is technically available, throwing ModuleUnavailableError otherwise.
 */
export function assertModuleAvailable(moduleKey: PlatformModuleKey): void {
  if (!isModuleTechnicallyAvailable(moduleKey)) {
    throw new ModuleUnavailableError(moduleKey);
  }
}
