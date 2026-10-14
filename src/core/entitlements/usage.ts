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

import {
  PUBLIC_DOMAINS_DEFAULT_LIMIT,
  PUBLIC_DOMAINS_QUOTA,
} from "@/core/domains/quota";

import { listQuotaEntries, type QuotaEntry } from "./catalog";
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

/**
 * Rows follow the quota catalog (CF4): the enforced keys, in its order;
 * planned keys have no measurement and stay on the plans page.
 */
export async function loadUsage(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<UsageView> {
  const contract = await loadCompanyContract(tx, ctx.organizationId);
  const rows: UsageRow[] = [];
  for (const entry of listQuotaEntries()) {
    if (entry.status !== "enforced") continue;
    const row = await usageRow(tx, ctx, contract, entry);
    if (row) rows.push(row);
  }
  return { contract, rows };
}

async function usageRow(
  tx: ContextTransaction,
  ctx: RequestContext,
  contract: CompanyContract,
  entry: QuotaEntry,
): Promise<UsageRow | null> {
  const base = { key: entry.key, label: entry.label, scope: entry.scope };
  if (entry.key === "core.seats") {
    const organization = await tx.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { maxSeats: true },
    });
    const seats = quotaFromContract(
      contract,
      entry.key,
      organization?.maxSeats ?? null,
    );
    return {
      ...base,
      used: await tx.organizationMember.count({
        where: { organizationId: ctx.organizationId, status: "active" },
      }),
      limit: seats.limit,
      source: seats.source,
    };
  }
  if (entry.key === PUBLIC_DOMAINS_QUOTA) {
    // Public domains of the workspace (CF2b); the plan sets the limit.
    const domains = quotaFromContract(
      contract,
      entry.key,
      PUBLIC_DOMAINS_DEFAULT_LIMIT,
    );
    return {
      ...base,
      used: await tx.workspaceDomain.count({
        where: { workspaceId: ctx.workspaceId },
      }),
      limit: domains.limit,
      source: domains.source,
    };
  }
  if (entry.owner === "core") return null;
  // Module quotas: only while the module is on (or suspended) here.
  const state = await getModuleAccessState(tx, ctx, entry.owner);
  if (state !== "enabled" && state !== "suspended") return null;
  const counter = MODULE_USAGE[entry.key];
  const quota = quotaFromContract(
    contract,
    entry.key,
    await defaultQuotaLimit(tx, entry.key),
  );
  return {
    ...base,
    scope: counter?.scope ?? entry.scope,
    used: counter ? await counter.count(tx, ctx) : null,
    limit: quota.limit,
    source: quota.source,
  };
}
