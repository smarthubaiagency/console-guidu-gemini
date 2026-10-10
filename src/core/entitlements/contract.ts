import "server-only";

import type { ContextTransaction } from "@/lib/prisma/with-context";
import { isSubscriptionStatus } from "@/core/billing/subscriptions";

import { type CompanyContract, LEGACY_CONTRACT } from "./types";

export { type CompanyContract, LEGACY_CONTRACT };

type ContractRow = {
  status: string;
  plan_name: string;
  plan_version: number;
  module_keys: string[];
  limits: unknown;
  provisional: boolean;
};

function toLimits(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" &&
        Number.isInteger(entry[1]) &&
        entry[1] >= 0,
    ),
  );
}

export async function loadCompanyContract(
  tx: ContextTransaction,
  organizationId: string,
): Promise<CompanyContract> {
  const rows = await tx.$queryRaw<ContractRow[]>`
    select status, plan_name, plan_version, module_keys, limits, provisional
    from private.organization_contract(${organizationId}::uuid)
  `;
  const row = rows[0];
  if (!row || !isSubscriptionStatus(row.status)) return LEGACY_CONTRACT;
  return {
    kind: "subscribed",
    status: row.status,
    planName: row.plan_name,
    planVersion: row.plan_version,
    moduleKeys: row.module_keys,
    limits: toLimits(row.limits),
    provisional: row.provisional,
  };
}
