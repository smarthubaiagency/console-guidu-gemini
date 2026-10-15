import "server-only";

import { environmentRateDefault } from "@/core/api/limits";
import { recordAudit } from "@/core/audit/record";
import {
  ceilingConflicts,
  listQuotaEntries,
  type PlanLimitValue,
  type QuotaEntry,
} from "@/core/entitlements/catalog";
import { loadCeilings, quotaFallbackLabel } from "@/core/entitlements/ceilings";
import { defaultQuotaLimit } from "@/core/entitlements/quotas";
import { adminAuditContext } from "@/core/module-runtime/settings";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  type BillingActor,
  canManagePlatformBilling,
  invalidBillingInput,
  requireAllowed,
} from "./access";
import { currentPlanVersion, listPlans, publishPlanVersion } from "./catalog";

/**
 * Planos e limites (CF4): the catalog of quota keys with the default
 * without a plan, the platform ceiling and the value of each plan on sale.
 * Plan values stay in the insert-only `plan_versions.limits`: changing
 * them publishes a new version with the same prices and modules, and the
 * subscriptions already open keep their version (criterion 6 of P5m).
 */

export type QuotaCatalogRow = Readonly<{
  entry: QuotaEntry;
  /** Default without a plan; null with `company` (per company) or none. */
  defaultLimit: number | null;
  /** Platform ceiling; null means no ceiling. */
  ceiling: number | null;
}>;

export type PlanLimitsColumn = Readonly<{
  planId: string;
  planKey: string;
  planName: string;
  version: number;
  provisional: boolean;
  limits: Readonly<Record<string, PlanLimitValue>>;
}>;

export type PlansLimitsView = Readonly<{
  rows: QuotaCatalogRow[];
  /** Active plans with a version: the current version of each. */
  plans: PlanLimitsColumn[];
}>;

/** The catalog, readable by any signed-in context (plans are not secret). */
export async function loadPlansLimits(
  tx: ContextTransaction,
): Promise<PlansLimitsView> {
  const ceilings = await loadCeilings(tx);
  const rows: QuotaCatalogRow[] = [];
  for (const entry of listQuotaEntries()) {
    const defaultLimit =
      entry.defaultSource === "module"
        ? await defaultQuotaLimit(tx, entry.key)
        : entry.defaultSource === "fixed"
          ? entry.defaultLimit
          : entry.defaultSource === "environment"
            ? environmentRateDefault(entry.key)
            : null;
    rows.push({
      entry,
      defaultLimit,
      ceiling: ceilings.get(entry.key) ?? null,
    });
  }
  const plans = (await listPlans(tx, { activeOnly: true })).flatMap((plan) => {
    const current = plan.versions[0];
    return current
      ? [
          {
            planId: plan.id,
            planKey: plan.key,
            planName: plan.name,
            version: current.version,
            provisional: current.provisional,
            limits: current.limits,
          },
        ]
      : [];
  });
  return { rows, plans };
}

/**
 * Saves the platform ceilings: a number sets it, null removes it (no
 * ceiling). Only changed keys are written and audited. A ceiling below the
 * current version of a plan on sale is refused.
 */
export async function saveQuotaCeilings(
  tx: ContextTransaction,
  actor: BillingActor,
  input: Readonly<Record<string, number | null>>,
): Promise<{ changed: number }> {
  requireAllowed(canManagePlatformBilling(actor));
  const known = new Set(listQuotaEntries().map((entry) => entry.key));
  if (Object.keys(input).some((key) => !known.has(key))) {
    throw invalidBillingInput("Limite de cota desconhecida no plano.");
  }
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('quota_ceilings'))`;
  const current = await loadCeilings(tx);
  const plans = (await listPlans(tx, { activeOnly: true })).flatMap((plan) =>
    plan.versions[0]
      ? [{ planName: plan.name, limits: plan.versions[0].limits }]
      : [],
  );
  let changed = 0;
  for (const [key, value] of Object.entries(input)) {
    const before = current.get(key) ?? null;
    if (before === value) continue;
    const conflict = ceilingConflicts(key, value, plans)[0];
    if (conflict) {
      const quota = quotaFallbackLabel(key);
      throw new AppError({
        code: "conflict",
        safeMessage: `${quota}: o plano ${conflict.planName} está à venda acima desse teto. Publique antes uma versão do plano dentro dele.`,
        messageKey: "plans.errors.ceilingBelowPlan",
        messageValues: { quota, quotaKey: key, plan: conflict.planName },
      });
    }
    if (value === null) {
      await tx.quotaCeiling.delete({ where: { quotaKey: key } });
    } else {
      await tx.quotaCeiling.upsert({
        where: { quotaKey: key },
        create: { quotaKey: key, ceiling: value, updatedBy: actor.userId },
        update: { ceiling: value, updatedBy: actor.userId },
        select: { quotaKey: true },
      });
    }
    await recordAudit(tx, adminAuditContext(actor.userId), {
      action: "billing.quota_ceiling.update",
      resourceType: "quota_ceiling",
      resourceId: key,
      result: "success",
      origin: "admin",
      metadata: {
        from: before === null ? "none" : String(before),
        to: value === null ? "none" : String(value),
      },
    });
    changed += 1;
  }
  return { changed };
}

/**
 * Publishes the limits of a plan as its next version, keeping the prices,
 * interval and modules of the current one. A key left out uses the
 * default; null is "sem limite".
 */
export async function publishPlanLimits(
  tx: ContextTransaction,
  actor: BillingActor,
  planId: string,
  limits: Readonly<Record<string, PlanLimitValue>>,
): Promise<{ id: string; version: number }> {
  requireAllowed(canManagePlatformBilling(actor));
  const current = await currentPlanVersion(tx, planId);
  if (!current) {
    throw new AppError({
      code: "invalid_input",
      safeMessage:
        "O plano ainda não tem versão: publique os valores em Cobrança antes.",
      messageKey: "plans.errors.noVersion",
    });
  }
  const published = await publishPlanVersion(tx, actor, planId, {
    billingInterval: current.billingInterval,
    moduleKeys: [...current.moduleKeys],
    minPriceCents: current.minPriceCents,
    minPlatformShareCents: current.minPlatformShareCents,
    partnerBasePriceCents: current.partnerBasePriceCents,
    provisional: current.provisional,
    limits: { ...limits },
  });
  const keys = new Set([
    ...Object.keys(current.limits),
    ...Object.keys(limits),
  ]);
  const fields = [...keys].filter(
    (key) =>
      Object.hasOwn(current.limits, key) !== Object.hasOwn(limits, key) ||
      current.limits[key] !== limits[key],
  );
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "billing.plan_limits.publish",
    resourceType: "plan",
    resourceId: planId,
    result: "success",
    origin: "admin",
    metadata: { version: published.version, fields },
  });
  return published;
}
