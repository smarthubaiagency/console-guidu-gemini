import type { CompanyContract } from "./types";

/**
 * What the contract allows for a module (F3b, decision 3):
 * - legacy (no subscription): full, as before;
 * - pending, active, past due: full when the module is in the plan;
 * - suspended: read only;
 * - canceled, or a module outside the plan: blocked, data preserved.
 *
 * A provisional plan version that lists no modules does not restrict them
 * ("módulos a definir"): the seeded plan waits for the Commercial numbers
 * (D-PA-11) and must not cut existing customers off. A final version with
 * no modules restricts every module.
 */
export type ModuleContractAccess = "full" | "read_only" | "blocked";

export function planIncludesModule(
  contract: CompanyContract,
  moduleKey: string,
): boolean {
  if (contract.kind === "legacy") return true;
  if (contract.provisional && contract.moduleKeys.length === 0) return true;
  return contract.moduleKeys.includes(moduleKey);
}

export function moduleContractAccess(
  contract: CompanyContract,
  moduleKey: string,
): ModuleContractAccess {
  if (contract.kind === "legacy") return "full";
  if (contract.status === "canceled") return "blocked";
  if (!planIncludesModule(contract, moduleKey)) return "blocked";
  if (contract.status === "suspended") return "read_only";
  return "full";
}

/** Limit of a quota: the plan's, else the default, else none (null). */
export function resolveQuotaLimit(
  contract: CompanyContract,
  key: string,
  defaultLimit: number | null,
): number | null {
  if (contract.kind === "subscribed" && key in contract.limits) {
    return contract.limits[key] ?? null;
  }
  return defaultLimit;
}
