import "server-only";

import { getModuleAccessState } from "@/core/module-runtime/state";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { aiAgentsQuotaUsage } from "@/modules/ai-agents/quotas";
import { crmQuotaUsage } from "@/modules/crm/quotas";
import { portfolioQuotaUsage } from "@/modules/portfolio/quotas";
import { helloWorldQuotaUsage } from "@/modules/hello-world/quotas";
import { listRegisteredModules } from "@/modules/registry";

import {
  PUBLIC_DOMAINS_DEFAULT_LIMIT,
  PUBLIC_DOMAINS_QUOTA,
} from "@/core/domains/quota";

import { loadCompanyContract } from "./contract";
import { defaultQuotaLimit, quotaFromContract } from "./quotas";
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
  ...crmQuotaUsage,
  ...portfolioQuotaUsage,
  ...helloWorldQuotaUsage,
  ...aiAgentsQuotaUsage,
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
  // Public domains of the workspace (CF2b); the plan sets the limit.
  const domains = quotaFromContract(
    contract,
    PUBLIC_DOMAINS_QUOTA,
    PUBLIC_DOMAINS_DEFAULT_LIMIT,
  );
  rows.push({
    key: PUBLIC_DOMAINS_QUOTA,
    label: "Domínios públicos do workspace",
    scope: "workspace",
    used: await tx.workspaceDomain.count({
      where: { workspaceId: ctx.workspaceId },
    }),
    limit: domains.limit,
    source: domains.source,
  });

  for (const mod of listRegisteredModules()) {
    for (const entitlement of mod.manifest.entitlements) {
      if (entitlement.kind !== "quota") continue;
      const state = await getModuleAccessState(tx, ctx, mod.manifest.moduleKey);
      if (state !== "enabled" && state !== "suspended") continue;
      const counter = MODULE_USAGE[entitlement.key];
      const quota = quotaFromContract(
        contract,
        entitlement.key,
        await defaultQuotaLimit(tx, entitlement.key),
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
