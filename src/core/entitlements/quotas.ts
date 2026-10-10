import "server-only";

import type { ContextTransaction } from "@/lib/prisma/with-context";
import { listRegisteredModules } from "@/modules/registry";
import { AppError } from "@/shared/errors";

import { loadCompanyContract } from "./contract";
import { resolveQuotaLimit } from "./rules";
import type { CompanyContract } from "./types";

/**
 * Quotas (Especificação §18, F3b): checked in the transaction that creates
 * the resource, under the caller's lock. The limit comes from the company's
 * plan version (`limits`), else from the default declared by the module
 * manifest or the core, else there is none. Going over a lower limit after
 * a plan change deletes nothing: only new creations are refused.
 */

export type QuotaDefinition = Readonly<{
  key: string;
  description: string;
  /** Whose resources count: the whole company or one workspace. */
  scope: "organization" | "workspace";
}>;

/** Quotas of the core. `core.seats` defaults to `organizations.max_seats`. */
export const CORE_QUOTAS: readonly QuotaDefinition[] = [
  {
    key: "core.seats",
    description: "Assentos da empresa (membros ativos e convites pendentes).",
    scope: "organization",
  },
];

export type QuotaView = Readonly<{
  key: string;
  limit: number | null;
  source: "plan" | "default" | "none";
}>;

/** Default limit declared by a module manifest for a quota key. */
export function manifestDefaultLimit(key: string): number | null {
  for (const mod of listRegisteredModules()) {
    const entitlement = mod.manifest.entitlements.find(
      (e) => e.key === key && e.kind === "quota",
    );
    if (entitlement) return entitlement.defaultLimit ?? null;
  }
  return null;
}

export function quotaFromContract(
  contract: CompanyContract,
  key: string,
  defaultLimit: number | null,
): QuotaView {
  const limit = resolveQuotaLimit(contract, key, defaultLimit);
  const fromPlan = contract.kind === "subscribed" && key in contract.limits;
  return {
    key,
    limit,
    source: fromPlan ? "plan" : limit === null ? "none" : "default",
  };
}

export async function resolveQuota(
  tx: ContextTransaction,
  organizationId: string,
  key: string,
  defaultLimit: number | null = manifestDefaultLimit(key),
): Promise<QuotaView> {
  const contract = await loadCompanyContract(tx, organizationId);
  return quotaFromContract(contract, key, defaultLimit);
}

export class QuotaExceededError extends AppError {
  constructor(
    readonly quotaKey: string,
    readonly limit: number,
    readonly used: number,
    label: string,
  ) {
    super({
      code: "conflict",
      safeMessage: `Limite do plano atingido: ${label} (${used} de ${limit}).`,
    });
    this.name = "QuotaExceededError";
  }
}

/**
 * Refuses a creation that would exceed the quota. The caller holds the lock
 * that serializes creations and passes the current usage.
 */
export function assertWithinQuota(
  quota: QuotaView,
  used: number,
  label: string,
  adding = 1,
): void {
  if (quota.limit !== null && used + adding > quota.limit) {
    throw new QuotaExceededError(quota.key, quota.limit, used, label);
  }
}

/** Seat limit of a company: the plan's `core.seats`, else `max_seats`. */
export async function resolveSeatLimit(
  tx: ContextTransaction,
  organizationId: string,
  maxSeats: number,
): Promise<number> {
  const quota = await resolveQuota(tx, organizationId, "core.seats", maxSeats);
  return quota.limit ?? maxSeats;
}
