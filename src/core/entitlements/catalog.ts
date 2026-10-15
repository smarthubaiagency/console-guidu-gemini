import { listRegisteredModules } from "@/modules/registry";

import { DEFAULT_RATE_LIMITS } from "@/core/api/limits";
import { PUBLIC_DOMAINS_DEFAULT_LIMIT } from "@/core/domains/quota";

/**
 * Catalog of every quota key (CF4, "Planos e limites"): one list with the
 * label, unit, scope and state of each limit a plan may set. The plans
 * page, the billing validation and the usage page read it, so a label or a
 * unit lives in one place. Translated labels live in the `plans`
 * namespace (`quotas.<key>`, dots and dashes as `_`) for the core keys
 * and in the module catalog (I4) for the module keys.
 *
 * - `enforced`: something counts and refuses over the limit today.
 * - `planned`: the survey asks for the field (levantamento.md, closing
 *   list item 1) but nothing enforces it yet ("ainda não aplicado"). A
 *   plan may already record a value, which only takes effect when the
 *   feature that enforces it ships.
 */

export type QuotaUnit =
  | "count"
  | "gigabytes"
  | "megabytes"
  | "requests_per_minute"
  | "per_month"
  | "days";

export type QuotaScope = "organization" | "workspace";

export type QuotaStatus = "enforced" | "planned";

/**
 * Where the limit comes from when the company has no plan value:
 * - `fixed`: the value below, from the code;
 * - `company`: the company's own record (`organizations.max_seats`);
 * - `module`: the platform settings of the module, else its manifest;
 * - `environment`: the environment of the deployment (the API limits per
 *   minute, CF6b), shown with its current value;
 * - `none`: nothing applies yet (planned keys).
 */
export type QuotaDefaultSource =
  "fixed" | "company" | "module" | "environment" | "none";

export type QuotaEntry = Readonly<{
  key: string;
  /** `core` or the module that declares the quota. */
  owner: string;
  /** Portuguese label, the fallback of the translations. */
  label: string;
  description: string;
  unit: QuotaUnit;
  scope: QuotaScope;
  status: QuotaStatus;
  defaultSource: QuotaDefaultSource;
  /** Default of the code (`fixed`) or of the manifest (`module`). */
  defaultLimit: number | null;
  /**
   * Whether a plan may say "sem limite". Seats always need a number: the
   * team pages and the invitations count against it.
   */
  unlimitedAllowed: boolean;
}>;

/** Highest value a plan or a ceiling may hold (same bound as F3b). */
export const MAX_QUOTA_VALUE = 1_000_000;

/** Quotas of the core, enforced and planned. */
export const CORE_QUOTA_ENTRIES: readonly QuotaEntry[] = [
  {
    key: "core.seats",
    owner: "core",
    label: "Assentos da empresa",
    description: "Membros ativos e convites pendentes da empresa.",
    unit: "count",
    scope: "organization",
    status: "enforced",
    defaultSource: "company",
    defaultLimit: null,
    unlimitedAllowed: false,
  },
  {
    key: "core.public_domains",
    owner: "core",
    label: "Domínios públicos do workspace",
    description:
      "Domínios próprios do site, perfil digital e quiz. Sem valor no plano, nenhum.",
    unit: "count",
    scope: "workspace",
    status: "enforced",
    defaultSource: "fixed",
    defaultLimit: PUBLIC_DOMAINS_DEFAULT_LIMIT,
    unlimitedAllowed: true,
  },
  {
    key: "core.storage_gb",
    owner: "core",
    label: "Armazenamento da empresa",
    description: "Arquivos guardados pela empresa (levantamento, item 5).",
    unit: "gigabytes",
    scope: "organization",
    status: "planned",
    defaultSource: "none",
    defaultLimit: null,
    unlimitedAllowed: true,
  },
  {
    key: "core.upload_mb",
    owner: "core",
    label: "Tamanho máximo de upload",
    description: "Maior arquivo aceito num envio (levantamento, item 5).",
    unit: "megabytes",
    scope: "organization",
    status: "planned",
    defaultSource: "none",
    defaultLimit: null,
    unlimitedAllowed: true,
  },
  // API and MCP limits per minute (CF6b): the plan's value, else the
  // environment's default, never above the ceiling (src/core/api/limits.ts).
  {
    key: "core.api_requests_per_minute",
    owner: "core",
    label: "Chamadas da API por minuto (workspace)",
    description:
      "Chamadas da API e do MCP por minuto, somando todas as chaves e pessoas do workspace.",
    unit: "requests_per_minute",
    scope: "workspace",
    status: "enforced",
    defaultSource: "environment",
    defaultLimit: DEFAULT_RATE_LIMITS.workspace,
    unlimitedAllowed: false,
  },
  {
    key: "core.api_key_requests_per_minute",
    owner: "core",
    label: "Chamadas da API por minuto (chave)",
    description: "Chamadas da API e do MCP por minuto de cada chave.",
    unit: "requests_per_minute",
    scope: "workspace",
    status: "enforced",
    defaultSource: "environment",
    defaultLimit: DEFAULT_RATE_LIMITS.key,
    unlimitedAllowed: false,
  },
  {
    key: "core.api_user_requests_per_minute",
    owner: "core",
    label: "Chamadas da API por minuto (pessoa)",
    description:
      "Chamadas da API e do MCP por minuto de cada pessoa, somando as chaves dela.",
    unit: "requests_per_minute",
    scope: "workspace",
    status: "enforced",
    defaultSource: "environment",
    defaultLimit: DEFAULT_RATE_LIMITS.user,
    unlimitedAllowed: false,
  },
  {
    key: "core.ai_turns_per_month",
    owner: "core",
    label: "Respostas de IA por mês",
    description:
      "Uso de IA por mês além do número de agentes (levantamento, item 11).",
    unit: "per_month",
    scope: "organization",
    status: "planned",
    defaultSource: "none",
    defaultLimit: null,
    unlimitedAllowed: true,
  },
  {
    key: "core.trial_days",
    owner: "core",
    label: "Dias de teste",
    description: "Período de teste do plano (levantamento, item 8).",
    unit: "days",
    scope: "organization",
    status: "planned",
    defaultSource: "none",
    defaultLimit: null,
    unlimitedAllowed: true,
  },
];

/** Every quota key: the core ones, then each module's, in registry order. */
export function listQuotaEntries(): QuotaEntry[] {
  return [
    ...CORE_QUOTA_ENTRIES,
    ...listRegisteredModules().flatMap((mod) =>
      mod.manifest.entitlements
        .filter((e) => e.kind === "quota")
        .map((e): QuotaEntry => ({
          key: e.key,
          owner: mod.manifest.moduleKey,
          label: `${mod.manifest.displayName}: ${e.description}`,
          description: e.description,
          unit: "count",
          scope: "workspace",
          status: "enforced",
          defaultSource: "module",
          defaultLimit: e.defaultLimit ?? null,
          unlimitedAllowed: true,
        })),
    ),
  ];
}

export function findQuotaEntry(key: string): QuotaEntry | null {
  return listQuotaEntries().find((entry) => entry.key === key) ?? null;
}

/** `plans.quotas.<id>` of a core key: dots and dashes as `_`. */
export function quotaMessageId(key: string): string {
  return key.replace(/[.-]/g, "_");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Value of a quota in a plan version (`plan_versions.limits`): a number,
 * or null for "sem limite". A key absent from the version uses the default.
 */
export type PlanLimitValue = number | null;

/** Ceiling of the platform per key; a key absent here has no ceiling. */
export type Ceilings = ReadonlyMap<string, number>;

export type LimitProblem = Readonly<{
  key: string;
  reason: "unknown" | "invalid" | "above_ceiling" | "unlimited_not_allowed";
  ceiling?: number;
}>;

function isQuotaNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_QUOTA_VALUE
  );
}

/**
 * Problems of the limits of a plan version against the catalog and the
 * ceilings: an unknown key, a value that is not a whole number in range,
 * a value above the ceiling, or "sem limite" where a ceiling exists or the
 * key does not accept it.
 */
export function validatePlanLimits(
  limits: Readonly<Record<string, unknown>>,
  entries: readonly QuotaEntry[],
  ceilings: Ceilings,
): LimitProblem[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const problems: LimitProblem[] = [];
  for (const [key, value] of Object.entries(limits)) {
    const entry = byKey.get(key);
    if (!entry) {
      problems.push({ key, reason: "unknown" });
      continue;
    }
    const ceiling = ceilings.get(key);
    if (value === null) {
      if (ceiling !== undefined || !entry.unlimitedAllowed) {
        problems.push({
          key,
          reason: "unlimited_not_allowed",
          ...(ceiling !== undefined ? { ceiling } : {}),
        });
      }
      continue;
    }
    if (!isQuotaNumber(value)) {
      problems.push({ key, reason: "invalid" });
      continue;
    }
    if (ceiling !== undefined && value > ceiling) {
      problems.push({ key, reason: "above_ceiling", ceiling });
    }
  }
  return problems;
}

/** Limits of a stored version: whole numbers and nulls, nothing else. */
export function parseStoredLimits(
  value: unknown,
): Record<string, PlanLimitValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, PlanLimitValue] =>
        entry[1] === null || isQuotaNumber(entry[1]),
    ),
  );
}

export type CeilingConflict = Readonly<{
  planName: string;
  value: PlanLimitValue;
}>;

/**
 * Plans whose current version would go over a new ceiling: a value above
 * it, or "sem limite". Lowering a ceiling below a plan on sale is refused
 * until the plan publishes a version within it; older versions, kept by
 * their subscriptions, are not touched (they were valid when published).
 */
export function ceilingConflicts(
  key: string,
  ceiling: number | null,
  currentVersions: ReadonlyArray<
    Readonly<{ planName: string; limits: Readonly<Record<string, unknown>> }>
  >,
): CeilingConflict[] {
  if (ceiling === null) return [];
  const conflicts: CeilingConflict[] = [];
  for (const version of currentVersions) {
    if (!Object.hasOwn(version.limits, key)) continue;
    const value = version.limits[key];
    if (value === null || (typeof value === "number" && value > ceiling)) {
      conflicts.push({ planName: version.planName, value });
    }
  }
  return conflicts;
}

/**
 * Reads a ceiling or a plan value typed in a form: empty is "not set",
 * otherwise a whole number in range. Returns undefined when invalid.
 */
export function parseQuotaInput(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return isQuotaNumber(value) ? value : undefined;
}
