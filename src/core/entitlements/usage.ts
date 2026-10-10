import "server-only";

import { getModuleAccessState } from "@/core/module-runtime/state";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { helloWorldQuotaUsage } from "@/modules/hello-world/quotas";
import { listRegisteredModules } from "@/modules/registry";

import { loadCompanyContract } from "./contract";
import { manifestDefaultLimit, quotaFromContract } from "./quotas";
import type { CompanyContract } from "./types";

/**
 * Measured usage against limits for "Consumo & Limites" (F3b, §21/§22).
 * Only real counts are shown; a quota without a measurement says so.
 */

type UsageCounter = Readonly<{
  moduleKey: string;
  scope: "organization" | "workspace";
  count: (tx: ContextTransaction, ctx: RequestContext) => Promise<number>;
}>;

/** Usage counters of module quotas, by explicit import (like jobs). */
const MODULE_USAGE: Readonly<Record<string, UsageCounter>> = {
  ...helloWorldQuotaUsage,
};

export type UsageRow = Readonly<{
  key: string;
  label: string;
  scope: "organization" | "workspace";
  used: number | null;
  limit: number | null;
  source: "plan" | "default" | "none";
}>;

export type UsageView = Readonly<{
  contract: CompanyContract;
  rows: UsageRow[];
}>;

export async function loadUsage(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<UsageView> {
  const contract = await loadCompanyContract(tx, ctx.organizationId);
  const organization = await tx.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { maxSeats: true },
  });
  const activeMembers = await tx.organizationMember.count({
    where: { organizationId: ctx.organizationId, status: "active" },
  });
  const seats = quotaFromContract(
    contract,
    "core.seats",
    organization?.maxSeats ?? null,
  );
  const rows: UsageRow[] = [
    {
      key: "core.seats",
      label: "Assentos da empresa (membros ativos)",
      scope: "organization",
      used: activeMembers,
      limit: seats.limit,
      source: seats.source,
    },
  ];

  for (const mod of listRegisteredModules()) {
    for (const entitlement of mod.manifest.entitlements) {
      if (entitlement.kind !== "quota") continue;
      const state = await getModuleAccessState(tx, ctx, mod.manifest.moduleKey);
      if (state !== "enabled" && state !== "suspended") continue;
      const counter = MODULE_USAGE[entitlement.key];
      const quota = quotaFromContract(
        contract,
        entitlement.key,
        manifestDefaultLimit(entitlement.key),
      );
      rows.push({
        key: entitlement.key,
        label: `${mod.manifest.displayName}: ${entitlement.description}`,
        scope: counter?.scope ?? "workspace",
        used: counter ? await counter.count(tx, ctx) : null,
        limit: quota.limit,
        source: quota.source,
      });
    }
  }
  return { contract, rows };
}
