import "server-only";

import { loadCeilings } from "@/core/entitlements/ceilings";
import { loadCompanyContract } from "@/core/entitlements/contract";
import type { WorkspaceScopeType } from "@/core/mcp/scopes";
import { readCascade } from "@/core/settings/read";
import { resolveSettings } from "@/core/settings/resolve";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import {
  allowedScopes,
  configuredRateLimits,
  type EffectiveRateLimit,
  effectiveRateLimits,
  type RateLimits,
  rateLimitValues,
} from "./limits";

/**
 * The API policy of a workspace (CF6b): its limits per minute and the
 * scopes its plan allows, read in the request's context (a key's or a
 * member's). Every request of the API and the MCP reads it again, so a
 * change of plan, ceiling or scopes applies at once.
 */

export type ApiPolicy = Readonly<{
  planKey: string | null;
  limits: RateLimits;
  detail: Readonly<Record<keyof RateLimits, EffectiveRateLimit>>;
  allowedScopes: WorkspaceScopeType[];
}>;

/** Key of the company's plan (open subscription, else the last canceled). */
export async function loadPlanKey(
  tx: ContextTransaction,
  organizationId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ key: string | null }[]>`
    select private.organization_plan_key(${organizationId}::uuid) as key
  `;
  return rows[0]?.key ?? null;
}

export async function loadApiPolicy(
  tx: ContextTransaction,
  ctx: RequestContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApiPolicy> {
  const contract = await loadCompanyContract(tx, ctx.organizationId);
  const planKey =
    contract.kind === "subscribed"
      ? await loadPlanKey(tx, ctx.organizationId)
      : null;
  const ceilings = await loadCeilings(tx);
  const settings = resolveSettings(await readCascade(tx)).values;
  const detail = effectiveRateLimits({
    planLimits: contract.kind === "subscribed" ? contract.limits : null,
    ceilings,
    defaults: configuredRateLimits(env),
  });
  return {
    planKey,
    limits: rateLimitValues(detail),
    detail,
    allowedScopes: allowedScopes(settings["api.plan_scopes"], planKey),
  };
}

/** Scopes the company's plan allows its API keys (CF6b). */
export async function loadAllowedScopes(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<WorkspaceScopeType[]> {
  const contract = await loadCompanyContract(tx, ctx.organizationId);
  const planKey =
    contract.kind === "subscribed"
      ? await loadPlanKey(tx, ctx.organizationId)
      : null;
  const settings = resolveSettings(await readCascade(tx)).values;
  return allowedScopes(settings["api.plan_scopes"], planKey);
}
