import "server-only";

import { z } from "zod";

import { loadPlansLimits } from "@/core/billing/limits";
import { listApiKeys } from "@/core/credentials/api-keys";
import {
  WORKSPACE_SCOPES,
  WorkspaceScopeSchema,
  type WorkspaceScopeType,
} from "@/core/mcp/scopes";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPlatformRolePermission,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import { readCascade } from "@/core/settings/read";
import { resolveSettings } from "@/core/settings/resolve";
import { saveSettings } from "@/core/settings/service";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  allowedScopes,
  configuredRateLimits,
  type PlanScopes,
  RATE_LIMIT_QUOTAS,
  type RateLimits,
} from "./limits";

/**
 * Plataforma › Configurações › API (CF6b): the emergency switches of the
 * REST API and of the MCP, the limits per minute (environment default,
 * platform ceiling and each plan's value, from the CF4 catalog), the
 * scopes each plan allows and the usage per key of every workspace.
 * The switches and the scopes are keys of the settings cascade, so their
 * writes go through `saveSettings` (RLS and audit).
 */

export type PlatformApiActor = Readonly<{
  userId: string;
  platformRole: string | null;
}>;

const BUCKETS = ["key", "user", "workspace"] as const;

export type ApiLimitRow = Readonly<{
  bucket: keyof RateLimits;
  quotaKey: string;
  defaultValue: number;
  ceiling: number | null;
  plans: ReadonlyArray<Readonly<{ planName: string; value: number | null }>>;
}>;

export type ApiPlanScopesRow = Readonly<{
  planKey: string;
  planName: string;
  scopes: WorkspaceScopeType[];
  /** False while the plan has no list of its own (every scope). */
  custom: boolean;
}>;

export type PlatformApiView = Readonly<{
  switches: Readonly<{ api: boolean; mcp: boolean }>;
  limits: ApiLimitRow[];
  plans: ApiPlanScopesRow[];
  canEdit: boolean;
}>;

function grants(actor: PlatformApiActor, permission: string): boolean {
  return (
    actor.platformRole !== null &&
    hasPlatformRolePermission(
      actor.platformRole as PlatformAdminRoleKey,
      permission as Parameters<typeof hasPlatformRolePermission>[1],
    )
  );
}

const canRead = (actor: PlatformApiActor) =>
  grants(actor, Permissions.PLATFORM_SETTINGS_MANAGE) ||
  grants(actor, Permissions.PLATFORM_SECURITY_READ);

const canEdit = (actor: PlatformApiActor) =>
  grants(actor, Permissions.PLATFORM_SETTINGS_MANAGE);

export async function platformApiView(
  tx: ContextTransaction,
  actor: PlatformApiActor,
): Promise<PlatformApiView> {
  if (!canRead(actor)) throw new PermissionDeniedError();
  const settings = resolveSettings(await readCascade(tx)).values;
  const catalog = await loadPlansLimits(tx);
  const defaults = configuredRateLimits();
  const limits = BUCKETS.map((bucket): ApiLimitRow => {
    const quotaKey = RATE_LIMIT_QUOTAS[bucket];
    const row = catalog.rows.find((r) => r.entry.key === quotaKey);
    return {
      bucket,
      quotaKey,
      defaultValue: defaults[bucket],
      ceiling: row?.ceiling ?? null,
      plans: catalog.plans.map((plan) => {
        const value = plan.limits[quotaKey];
        return {
          planName: plan.planName,
          value: typeof value === "number" ? value : null,
        };
      }),
    };
  });
  const planScopes = settings["api.plan_scopes"] as PlanScopes;
  const plans = catalog.plans.map((plan): ApiPlanScopesRow => ({
    planKey: plan.planKey,
    planName: plan.planName,
    scopes: allowedScopes(planScopes, plan.planKey),
    custom: Object.hasOwn(planScopes, plan.planKey),
  }));
  return {
    switches: {
      api: settings["api.rest_enabled"] !== false,
      mcp: settings["api.mcp_enabled"] !== false,
    },
    limits,
    plans,
    canEdit: canEdit(actor),
  };
}

const platformActor = (actor: PlatformApiActor) =>
  ({ level: "platform", ...actor }) as const;

/** Turns the REST API and the MCP on or off (emergency switches). */
export async function saveApiSwitches(
  tx: ContextTransaction,
  actor: PlatformApiActor,
  input: Readonly<{ api: boolean; mcp: boolean }>,
): Promise<void> {
  if (!canEdit(actor)) throw new PermissionDeniedError();
  await saveSettings(tx, platformActor(actor), {
    values: {
      // On is the default: stored only while off.
      "api.rest_enabled": input.api ? null : false,
      "api.mcp_enabled": input.mcp ? null : false,
    },
  });
}

const ScopesInput = z.record(z.string(), z.array(WorkspaceScopeSchema));

/**
 * Saves the scopes of the plans on sale. A plan with every scope stores no
 * list ("todos"); the lists of retired plans are kept as they are.
 */
export async function savePlanScopes(
  tx: ContextTransaction,
  actor: PlatformApiActor,
  input: unknown,
): Promise<void> {
  if (!canEdit(actor)) throw new PermissionDeniedError();
  const parsed = ScopesInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Escopo desconhecido.",
      messageKey: "apiSettings.errors.invalid",
    });
  }
  const catalog = await loadPlansLimits(tx);
  const onSale = new Set(catalog.plans.map((plan) => plan.planKey));
  if (Object.keys(parsed.data).some((key) => !onSale.has(key))) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Plano desconhecido.",
      messageKey: "apiSettings.errors.unknownPlan",
    });
  }
  const current = resolveSettings(await readCascade(tx)).values[
    "api.plan_scopes"
  ] as PlanScopes;
  const next: Record<string, WorkspaceScopeType[]> = {};
  for (const [key, scopes] of Object.entries(current)) {
    if (!onSale.has(key)) next[key] = [...scopes];
  }
  for (const [key, scopes] of Object.entries(parsed.data)) {
    const ordered = WORKSPACE_SCOPES.filter((scope) => scopes.includes(scope));
    if (ordered.length < WORKSPACE_SCOPES.length) next[key] = ordered;
  }
  await saveSettings(tx, platformActor(actor), {
    values: {
      "api.plan_scopes": Object.keys(next).length > 0 ? next : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Usage per key
// ---------------------------------------------------------------------------

export type KeyUsageRow = Readonly<{
  apiKeyId: string;
  name: string;
  prefix: string;
  status: string;
  workspaceName: string | null;
  organizationName: string | null;
  calls: number;
  errors: number;
  mcpCalls: number;
}>;

export type DayUsageRow = Readonly<{
  day: string;
  calls: number;
  errors: number;
}>;

export type KeyUsageView = Readonly<{
  days: number;
  keys: KeyUsageRow[];
  byDay: DayUsageRow[];
}>;

export const USAGE_DAYS = 30;

/** First day of the window, as a São Paulo calendar date. */
export function usageSince(days: number, now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(now);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

type UsageLine = {
  apiKeyId: string;
  name: string;
  prefix: string;
  status: string;
  workspaceName: string | null;
  organizationName: string | null;
  day: string;
  surface: string;
  calls: number;
  errors: number;
};

function summarize(lines: readonly UsageLine[], days: number): KeyUsageView {
  const keys = new Map<string, KeyUsageRow>();
  const byDay = new Map<string, { calls: number; errors: number }>();
  for (const line of lines) {
    const key = keys.get(line.apiKeyId) ?? {
      apiKeyId: line.apiKeyId,
      name: line.name,
      prefix: line.prefix,
      status: line.status,
      workspaceName: line.workspaceName,
      organizationName: line.organizationName,
      calls: 0,
      errors: 0,
      mcpCalls: 0,
    };
    keys.set(line.apiKeyId, {
      ...key,
      calls: key.calls + line.calls,
      errors: key.errors + line.errors,
      mcpCalls: key.mcpCalls + (line.surface === "mcp" ? line.calls : 0),
    });
    const day = byDay.get(line.day) ?? { calls: 0, errors: 0 };
    byDay.set(line.day, {
      calls: day.calls + line.calls,
      errors: day.errors + line.errors,
    });
  }
  return {
    days,
    keys: [...keys.values()].sort(
      (a, b) => b.calls - a.calls || a.name.localeCompare(b.name),
    ),
    byDay: [...byDay.entries()]
      .map(([day, totals]) => ({ day, ...totals }))
      .sort((a, b) => b.day.localeCompare(a.day)),
  };
}

const dayText = (value: Date | string) =>
  typeof value === "string"
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);

/** Every workspace key's usage (owner, operations and support). */
export async function platformKeyUsage(
  tx: ContextTransaction,
  actor: PlatformApiActor,
  days: number = USAGE_DAYS,
): Promise<KeyUsageView> {
  if (!canRead(actor)) throw new PermissionDeniedError();
  const since = usageSince(days);
  const rows = await tx.$queryRaw<
    {
      api_key_id: string;
      key_name: string;
      key_prefix: string;
      key_status: string;
      workspace_name: string | null;
      organization_name: string | null;
      day: Date;
      surface: string;
      calls: number;
      errors: number;
    }[]
  >`select api_key_id, key_name, key_prefix, key_status, workspace_name,
           organization_name, day, surface, calls, errors
    from private.api_key_usage_overview(${since}::date)`;
  return summarize(
    rows.map((row) => ({
      apiKeyId: row.api_key_id,
      name: row.key_name,
      prefix: row.key_prefix,
      status: row.key_status,
      workspaceName: row.workspace_name,
      organizationName: row.organization_name,
      day: dayText(row.day),
      surface: row.surface,
      calls: Number(row.calls),
      errors: Number(row.errors),
    })),
    days,
  );
}

/**
 * Usage of the keys the member sees in the workspace (their own, or every
 * key for owner and admin, by the keys' RLS).
 */
export async function workspaceKeyUsage(
  tx: ContextTransaction,
  ctx: RequestContext,
  days: number = USAGE_DAYS,
): Promise<KeyUsageView> {
  const keys = await listApiKeys(tx, ctx);
  const since = usageSince(days);
  const rows = await tx.apiKeyUsageDaily.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      day: { gte: new Date(`${since}T00:00:00Z`) },
    },
  });
  const byId = new Map(keys.map((key) => [key.id, key]));
  return summarize(
    rows.flatMap((row) => {
      const key = byId.get(row.apiKeyId);
      return key
        ? [
            {
              apiKeyId: row.apiKeyId,
              name: key.name,
              prefix: key.prefix,
              status: key.status,
              workspaceName: null,
              organizationName: null,
              day: dayText(row.day),
              surface: row.surface,
              calls: row.calls,
              errors: row.errors,
            },
          ]
        : [];
    }),
    days,
  );
}
