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
 * plan version (`limits`), else from the default set in the platform
 * settings of the module (`platform_modules.config.quotaDefaults`, F5a),
 * else from the default declared by the module manifest or the core, else
 * there is none. Going over a lower limit after
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
  {
    key: "core.public_domains",
    description:
      "Domínios públicos por workspace (site, perfil digital e quiz). Sem limite no plano, nenhum.",
    scope: "workspace",
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

/** Module that declares a quota key, if any. */
function moduleOfQuota(key: string): string | null {
  for (const mod of listRegisteredModules()) {
    if (
      mod.manifest.entitlements.some((e) => e.key === key && e.kind === "quota")
    ) {
      return mod.manifest.moduleKey;
    }
  }
  return null;
}

/**
 * Default limit of a module quota: the platform setting of the module when
 * present (Plataforma › Configurações de módulos), else the manifest.
 */
export async function defaultQuotaLimit(
  tx: ContextTransaction,
  key: string,
): Promise<number | null> {
  const moduleKey = moduleOfQuota(key);
  if (!moduleKey) return manifestDefaultLimit(key);
  const row = await tx.platformModule.findUnique({
    where: { moduleKey },
    select: { config: true },
  });
  const defaults = (row?.config as { quotaDefaults?: unknown } | null)
    ?.quotaDefaults;
  const value =
    defaults && typeof defaults === "object"
      ? (defaults as Record<string, unknown>)[key]
      : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : manifestDefaultLimit(key);
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
  defaultLimit?: number | null,
): Promise<QuotaView> {
  const contract = await loadCompanyContract(tx, organizationId);
  return quotaFromContract(
    contract,
    key,
    defaultLimit === undefined
      ? await defaultQuotaLimit(tx, key)
      : defaultLimit,
  );
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
      messageKey: "apiErrors.quotaExceeded",
      // `quotaKey` lets the English of the API name the quota from the
      // module catalog (I5); `quota` is the caller's Portuguese label.
      messageValues: { quota: label, quotaKey, used, limit },
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
