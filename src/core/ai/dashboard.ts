import "server-only";

import { requirePlatformPermission } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  type PartnerRoleKey,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { aiPolicy } from "./catalog";
import {
  AI_PROVIDERS,
  type AiPolicy,
  type AiProviderId,
  isAiProvider,
  modelWarning,
} from "./models";

/**
 * IA › Painel (CF6a): usage and errors by provider and by partner (the
 * platform) or by customer (the partner), from the usage recorded per
 * model call (`ai_usage_events`, failed calls with `error_code`), and the
 * notices that need someone: backup key missing, GUIDS on the backup or
 * paused by a failed key, a provider failing, agents outside the catalog
 * and the Assistant without a key. Aggregates only: no conversation.
 */

export const DASHBOARD_PERIODS = [7, 30] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export function dashboardPeriod(raw: unknown): DashboardPeriod {
  return Number(raw) === 7 ? 7 : 30;
}

/** A provider failing: at least this share of errors and this many. */
export const ERROR_RATE_ALERT = 0.2;
export const ERROR_COUNT_ALERT = 5;

export type UsageTotals = Readonly<{
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}>;

export type ProviderUsage = UsageTotals &
  Readonly<{
    provider: AiProviderId;
    enabled: boolean;
    /** The most frequent error code of the period. */
    topError: string | null;
  }>;

export type GroupUsage = UsageTotals &
  Readonly<{ id: string | null; name: string | null }>;

export type DashboardNotice = Readonly<{
  kind:
    | "backup_missing"
    | "agents_backup"
    | "agents_failed"
    | "provider_errors"
    | "provider_off"
    | "model_off"
    | "agents_no_model"
    | "assistant_no_key";
  count: number;
  provider?: AiProviderId;
}>;

export type AiDashboard = Readonly<{
  days: DashboardPeriod;
  totals: UsageTotals;
  providersEnabled: number;
  providers: ProviderUsage[];
  /** Platform: by partner. Partner: by customer (organization). */
  groups: GroupUsage[];
  notices: DashboardNotice[];
}>;

type UsageRow = Readonly<{
  group: string | null;
  provider: string;
  errorCode: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}>;

type AgentRow = Readonly<{
  kind: string;
  status: string;
  keyState: string;
  provider: string | null;
  model: string | null;
  hasKey: boolean;
  agents: number;
}>;

const empty = (): { -readonly [K in keyof UsageTotals]: number } => ({
  requests: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
});

function add(
  totals: { -readonly [K in keyof UsageTotals]: number },
  row: UsageRow,
): void {
  if (row.errorCode) totals.errors += row.requests;
  else totals.requests += row.requests;
  totals.inputTokens += row.inputTokens;
  totals.outputTokens += row.outputTokens;
}

/** Pure: the dashboard from the usage and agent rows (tested alone). */
export function buildDashboard(
  input: Readonly<{
    days: DashboardPeriod;
    policy: AiPolicy;
    usage: readonly UsageRow[];
    agents: readonly AgentRow[];
    groupNames: ReadonlyMap<string, string>;
    backupConfigured: boolean | null;
  }>,
): AiDashboard {
  const totals = empty();
  const byProvider = new Map<AiProviderId, ReturnType<typeof empty>>();
  const errorsByProvider = new Map<AiProviderId, Map<string, number>>();
  const byGroup = new Map<string | null, ReturnType<typeof empty>>();
  for (const row of input.usage) {
    add(totals, row);
    if (isAiProvider(row.provider)) {
      const sum = byProvider.get(row.provider) ?? empty();
      add(sum, row);
      byProvider.set(row.provider, sum);
      if (row.errorCode) {
        const codes = errorsByProvider.get(row.provider) ?? new Map();
        codes.set(
          row.errorCode,
          (codes.get(row.errorCode) ?? 0) + row.requests,
        );
        errorsByProvider.set(row.provider, codes);
      }
    }
    const sum = byGroup.get(row.group) ?? empty();
    add(sum, row);
    byGroup.set(row.group, sum);
  }

  const providers: ProviderUsage[] = AI_PROVIDERS.map((provider) => {
    const codes = [...(errorsByProvider.get(provider) ?? new Map()).entries()];
    codes.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      provider,
      enabled: input.policy.providers.includes(provider),
      topError: codes[0]?.[0] ?? null,
      ...(byProvider.get(provider) ?? empty()),
    };
  });

  const groups: GroupUsage[] = [...byGroup.entries()]
    .map(([id, sum]) => ({
      id,
      name: id ? (input.groupNames.get(id) ?? null) : null,
      ...sum,
    }))
    .sort(
      (a, b) =>
        b.requests + b.errors - (a.requests + a.errors) ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );

  const notices: DashboardNotice[] = [];
  if (input.backupConfigured === false) {
    notices.push({ kind: "backup_missing", count: 1 });
  }
  const count = (filter: (row: AgentRow) => boolean) =>
    input.agents.filter(filter).reduce((sum, row) => sum + row.agents, 0);
  const guid = (row: AgentRow) => row.kind === "guid";
  const backup = count((row) => guid(row) && row.keyState === "backup");
  if (backup > 0) notices.push({ kind: "agents_backup", count: backup });
  const failed = count((row) => guid(row) && row.keyState === "failed");
  if (failed > 0) notices.push({ kind: "agents_failed", count: failed });
  for (const provider of providers) {
    const calls = provider.requests + provider.errors;
    if (
      provider.errors >= ERROR_COUNT_ALERT &&
      provider.errors / calls >= ERROR_RATE_ALERT
    ) {
      notices.push({
        kind: "provider_errors",
        count: provider.errors,
        provider: provider.provider,
      });
    }
  }
  const providerOff = count(
    (row) =>
      modelWarning(input.policy, row.provider, row.model) === "provider_off",
  );
  if (providerOff > 0)
    notices.push({ kind: "provider_off", count: providerOff });
  const modelOff = count(
    (row) =>
      modelWarning(input.policy, row.provider, row.model) === "model_off",
  );
  if (modelOff > 0) notices.push({ kind: "model_off", count: modelOff });
  const noModel = count(
    (row) =>
      guid(row) && row.status === "active" && (!row.model || !row.provider),
  );
  if (noModel > 0) notices.push({ kind: "agents_no_model", count: noModel });
  const assistantNoKey = count(
    (row) => row.kind === "assistant" && row.status === "active" && !row.hasKey,
  );
  if (assistantNoKey > 0) {
    notices.push({ kind: "assistant_no_key", count: assistantNoKey });
  }

  return {
    days: input.days,
    totals,
    providersEnabled: input.policy.providers.length,
    providers,
    groups,
    notices,
  };
}

function since(days: DashboardPeriod, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** The platform's dashboard: every partner (owner and operations). */
export async function platformAiDashboard(
  tx: ContextTransaction,
  role: PlatformAdminRoleKey | null,
  days: DashboardPeriod,
  now: Date = new Date(),
): Promise<AiDashboard> {
  requirePlatformPermission(role, Permissions.PLATFORM_AI_MANAGE);
  const [usage, agents, partners, backup, policy] = await Promise.all([
    tx.$queryRaw<
      Array<{
        partner_id: string | null;
        provider: string;
        error_code: string | null;
        requests: bigint;
        input_tokens: bigint;
        output_tokens: bigint;
      }>
    >`select partner_id, provider, error_code, requests, input_tokens, output_tokens
      from private.ai_usage_overview(${since(days, now)})`,
    tx.$queryRaw<
      Array<{
        kind: string;
        status: string;
        key_state: string;
        provider: string | null;
        model: string | null;
        agents: bigint;
      }>
    >`select kind, status, key_state, provider, model, agents
      from private.ai_agents_overview()`,
    tx.partner.findMany({ select: { id: true, name: true } }),
    tx.platformAiSettings.findUnique({
      where: { id: true },
      select: { backupProvider: true, backupModel: true },
    }),
    aiPolicy(tx),
  ]);
  return buildDashboard({
    days,
    policy,
    usage: usage.map((row) => ({
      group: row.partner_id,
      provider: row.provider,
      errorCode: row.error_code,
      requests: Number(row.requests),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
    })),
    // The overview has no keys: an Assistant counts by its model.
    agents: agents.map((row) => ({
      kind: row.kind,
      status: row.status,
      keyState: row.key_state,
      provider: row.provider,
      model: row.model,
      hasKey: row.provider !== null,
      agents: Number(row.agents),
    })),
    groupNames: new Map(partners.map((p) => [p.id, p.name])),
    backupConfigured: Boolean(backup?.backupProvider && backup.backupModel),
  });
}

export type PartnerDashboardActor = Readonly<{
  partnerId: string;
  partnerRole: PartnerRoleKey | null;
}>;

/** The partner's dashboard: its customers, and its Assistant's key. */
export async function partnerAiDashboard(
  tx: ContextTransaction,
  actor: PartnerDashboardActor,
  days: DashboardPeriod,
  now: Date = new Date(),
): Promise<AiDashboard> {
  if (
    !actor.partnerRole ||
    !hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_AI_AGENTS_READ,
    )
  ) {
    throw new PermissionDeniedError();
  }
  const from = since(days, now);
  // RLS: the customers' usage (CF6a) and, for owner, admin and finance,
  // the partner's own admin key.
  const [usage, agents, organizations, policy] = await Promise.all([
    tx.aiUsageEvent.groupBy({
      by: ["organizationId", "keySource", "provider", "errorCode"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    tx.aiAgent.findMany({
      where: {
        OR: [
          { kind: "guid" },
          { kind: "assistant", partnerId: actor.partnerId },
        ],
      },
      select: { kind: true, status: true, keyState: true, config: true },
    }),
    tx.organization.findMany({
      where: { partnerId: actor.partnerId },
      select: { id: true, name: true },
    }),
    aiPolicy(tx),
  ]);
  const customers = new Set(organizations.map((o) => o.id));
  const rows: UsageRow[] = usage
    .filter(
      (row) =>
        row.keySource === "admin" ||
        (row.organizationId !== null && customers.has(row.organizationId)),
    )
    .map((row) => ({
      // The Assistant's own spend is one line of its own (no customer).
      group: row.keySource === "admin" ? null : row.organizationId,
      provider: row.provider,
      errorCode: row.errorCode,
      requests: row._count._all,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
    }));
  return buildDashboard({
    days,
    policy,
    usage: rows,
    agents: agents.map((agent) => {
      const model = (agent.config as { model?: Record<string, unknown> })
        ?.model;
      const text = (value: unknown) =>
        typeof value === "string" && value ? value : null;
      return {
        kind: agent.kind,
        status: agent.status,
        keyState: agent.keyState,
        provider: text(model?.model_provider),
        model: text(model?.model_name),
        hasKey: text(model?.credential_id) !== null,
        agents: 1,
      };
    }),
    groupNames: new Map(organizations.map((o) => [o.id, o.name])),
    backupConfigured: null,
  });
}
