import type { AuditOrigin, AuditResult } from "@/core/audit/record";

/**
 * Filters, cursor and shapes of Plataforma › Auditoria (AUD1), shared by
 * the server reading (`platform-read.ts`) and the filters of the screen.
 * Pure functions: nothing here touches the database.
 */

export const PLATFORM_AUDIT_PAGE = 50;
export const AUDIT_RESULTS: readonly AuditResult[] = [
  "success",
  "denied",
  "error",
];
export const AUDIT_ORIGINS: readonly AuditOrigin[] = [
  "app",
  "api",
  "mcp",
  "worker",
  "admin",
];

/**
 * Days of the period are read in the platform time zone, America/Sao_Paulo,
 * which has had a fixed offset since daylight saving ended in 2019.
 */
const PLATFORM_OFFSET = "-03:00";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_PREFIX = /^[a-z0-9_.]{1,80}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)_([0-9a-f-]{36})$/i;

export type PlatformAuditFilters = Readonly<{
  partnerId: string | null;
  organizationId: string | null;
  workspaceId: string | null;
  /** Prefix of the action, e.g. `billing.` or `partner.member`. */
  action: string | null;
  result: AuditResult | null;
  origin: AuditOrigin | null;
  actorUserId: string | null;
  /** First day of the period (YYYY-MM-DD), inclusive. */
  from: string | null;
  /** Last day of the period (YYYY-MM-DD), inclusive. */
  to: string | null;
}>;

export const EMPTY_AUDIT_FILTERS: PlatformAuditFilters = {
  partnerId: null,
  organizationId: null,
  workspaceId: null,
  action: null,
  result: null,
  origin: null,
  actorUserId: null,
  from: null,
  to: null,
};

/** Position after the last row shown: its instant (microseconds) and id. */
export type AuditCursor = Readonly<{ at: string; id: string }>;

export type PlatformAuditEvent = Readonly<{
  id: string;
  /** ISO instant, for display. */
  occurredAt: string;
  action: string;
  result: AuditResult;
  origin: string;
  actorUserId: string | null;
  /** Name or e-mail of the actor when the platform reads it, else null. */
  actorName: string | null;
  actorPrincipalType: string;
  representedUserId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  partnerId: string | null;
  partnerName: string | null;
  resourceType: string;
  resourceId: string | null;
  clientId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  /** Also listed in the security events (CF5a). */
  isSecurity: boolean;
}>;

export type PlatformAuditPage = Readonly<{
  events: PlatformAuditEvent[];
  /** Cursor of the next (older) page, or null at the end. */
  next: string | null;
}>;

export type AuditFilterOptions = Readonly<{
  partners: ReadonlyArray<{ id: string; name: string }>;
  organizations: ReadonlyArray<{ id: string; name: string }>;
  workspaces: ReadonlyArray<{
    id: string;
    name: string;
    organizationName: string;
  }>;
}>;

function single(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function uuidOrNull(raw: string | string[] | undefined): string | null {
  const value = single(raw);
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

function dayOrNull(raw: string | string[] | undefined): string | null {
  const value = single(raw);
  if (!value || !DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/**
 * Filters from the address bar. Anything malformed is dropped, never sent
 * to the database; a period whose end comes before its start keeps only
 * the start.
 */
export function parseAuditFilters(
  params: Readonly<Record<string, string | string[] | undefined>>,
): PlatformAuditFilters {
  const action = single(params.action)?.toLowerCase() ?? null;
  const result = single(params.result);
  const origin = single(params.origin);
  const from = dayOrNull(params.from);
  const to = dayOrNull(params.to);
  return {
    partnerId: uuidOrNull(params.partner),
    organizationId: uuidOrNull(params.organization),
    workspaceId: uuidOrNull(params.workspace),
    action: action && ACTION_PREFIX.test(action) ? action : null,
    result: AUDIT_RESULTS.includes(result as AuditResult)
      ? (result as AuditResult)
      : null,
    origin: AUDIT_ORIGINS.includes(origin as AuditOrigin)
      ? (origin as AuditOrigin)
      : null,
    actorUserId: uuidOrNull(params.actor),
    from,
    to: from && to && to < from ? null : to,
  };
}

/** Query string of the filters (and cursor), without empty values. */
export function auditSearchParams(
  filters: PlatformAuditFilters,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | null]> = [
    ["partner", filters.partnerId],
    ["organization", filters.organizationId],
    ["workspace", filters.workspaceId],
    ["action", filters.action],
    ["result", filters.result],
    ["origin", filters.origin],
    ["actor", filters.actorUserId],
    ["from", filters.from],
    ["to", filters.to],
    ["before", cursor ?? null],
  ];
  for (const [key, value] of entries) if (value) params.set(key, value);
  return params.toString();
}

export function encodeAuditCursor(cursor: AuditCursor): string {
  return `${cursor.at}_${cursor.id}`;
}

/** A cursor from the address bar (`<instant>_<id>`), or null. */
export function parseAuditCursor(
  raw: string | string[] | undefined,
): AuditCursor | null {
  const value = single(raw);
  if (!value || value.length > 80) return null;
  const match = CURSOR.exec(value);
  if (!match || !UUID.test(match[2]!)) return null;
  if (Number.isNaN(new Date(match[1]!).getTime())) return null;
  return { at: match[1]!, id: match[2]!.toLowerCase() };
}

/** Start of the first day and start of the day after the last one. */
export function periodBounds(filters: PlatformAuditFilters): {
  from: string | null;
  to: string | null;
} {
  const from = filters.from
    ? `${filters.from}T00:00:00${PLATFORM_OFFSET}`
    : null;
  let to: string | null = null;
  if (filters.to) {
    const next = new Date(`${filters.to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    to = `${next.toISOString().slice(0, 10)}T00:00:00${PLATFORM_OFFSET}`;
  }
  return { from, to };
}
