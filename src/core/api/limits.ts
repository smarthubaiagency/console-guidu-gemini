import { WORKSPACE_SCOPES, type WorkspaceScopeType } from "@/core/mcp/scopes";

/**
 * Limits and scopes of the API and the MCP per plan (CF6b, levantamento
 * item 12). Pure: the policy loader (`./policy.ts`) feeds it the plan, the
 * ceilings and the settings.
 *
 * - The three limits per minute are quota keys of the CF4 catalog: the
 *   plan's value, else the environment's (`API_RATE_LIMIT_PER_*`, the old
 *   source, now only the default), never above the platform ceiling. A
 *   plan's "sem limite" left over from before counts as the default.
 * - The scopes a plan allows come from `api.plan_scopes` (platform only):
 *   a plan without an entry, or a company without a plan, allows them all.
 */

export type RateLimits = Readonly<{
  key: number;
  user: number;
  workspace: number;
}>;

/** Quota key of each bucket in the CF4 catalog. */
export const RATE_LIMIT_QUOTAS = {
  key: "core.api_key_requests_per_minute",
  user: "core.api_user_requests_per_minute",
  workspace: "core.api_requests_per_minute",
} as const satisfies Record<keyof RateLimits, string>;

export const DEFAULT_RATE_LIMITS: RateLimits = {
  key: 60,
  user: 120,
  workspace: 300,
};

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** The environment's limits: the default of every plan. */
export function configuredRateLimits(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RateLimits {
  return {
    key: positive(env.API_RATE_LIMIT_PER_KEY, DEFAULT_RATE_LIMITS.key),
    user: positive(env.API_RATE_LIMIT_PER_USER, DEFAULT_RATE_LIMITS.user),
    workspace: positive(
      env.API_RATE_LIMIT_PER_WORKSPACE,
      DEFAULT_RATE_LIMITS.workspace,
    ),
  };
}

/** Default of a rate quota key (the environment), or null for other keys. */
export function environmentRateDefault(
  quotaKey: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | null {
  const limits = configuredRateLimits(env);
  for (const bucket of Object.keys(RATE_LIMIT_QUOTAS) as (keyof RateLimits)[]) {
    if (RATE_LIMIT_QUOTAS[bucket] === quotaKey) return limits[bucket];
  }
  return null;
}

export type RateLimitSource = "plan" | "default";

export type EffectiveRateLimit = Readonly<{
  value: number;
  source: RateLimitSource;
  ceiling: number | null;
}>;

/** Each bucket's limit: plan, else default, capped by the ceiling. */
export function effectiveRateLimits(
  input: Readonly<{
    /** Plan values of the company; null without a plan. */
    planLimits: Readonly<Record<string, number | null>> | null;
    ceilings: ReadonlyMap<string, number>;
    defaults: RateLimits;
  }>,
): Readonly<Record<keyof RateLimits, EffectiveRateLimit>> {
  const one = (bucket: keyof RateLimits): EffectiveRateLimit => {
    const key = RATE_LIMIT_QUOTAS[bucket];
    const planValue = input.planLimits?.[key];
    const fromPlan = typeof planValue === "number";
    const ceiling = input.ceilings.get(key) ?? null;
    const raw = fromPlan ? planValue : input.defaults[bucket];
    return {
      value: ceiling === null ? raw : Math.min(raw, ceiling),
      source: fromPlan ? "plan" : "default",
      ceiling,
    };
  };
  return { key: one("key"), user: one("user"), workspace: one("workspace") };
}

export function rateLimitValues(
  limits: Readonly<Record<keyof RateLimits, EffectiveRateLimit>>,
): RateLimits {
  return {
    key: limits.key.value,
    user: limits.user.value,
    workspace: limits.workspace.value,
  };
}

/** Scopes each plan allows, by plan key (`api.plan_scopes`). */
export type PlanScopes = Readonly<
  Record<string, readonly WorkspaceScopeType[]>
>;

/**
 * Scopes the company's plan allows: the plan's list, or every scope when
 * the plan has no entry or the company has no plan.
 */
export function allowedScopes(
  planScopes: PlanScopes,
  planKey: string | null,
): WorkspaceScopeType[] {
  if (planKey && Object.hasOwn(planScopes, planKey)) {
    const listed = planScopes[planKey] ?? [];
    return WORKSPACE_SCOPES.filter((scope) => listed.includes(scope));
  }
  return [...WORKSPACE_SCOPES];
}

/** A key's scopes the plan still allows (a scope taken away stops working). */
export function usableScopes(
  keyScopes: readonly WorkspaceScopeType[],
  allowed: readonly WorkspaceScopeType[],
): WorkspaceScopeType[] {
  return keyScopes.filter((scope) => allowed.includes(scope));
}
