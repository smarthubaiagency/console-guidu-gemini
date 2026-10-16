import "server-only";

import {
  type AuditCursor,
  type AuditFilterOptions,
  EMPTY_AUDIT_FILTERS,
  encodeAuditCursor,
  periodBounds,
  PLATFORM_AUDIT_PAGE,
  type PlatformAuditFilters,
  type PlatformAuditPage,
} from "@/core/audit/platform-filters";
import type { AuditResult } from "@/core/audit/record";
import { requirePlatformPermission } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Plataforma › Auditoria (AUD1): the whole `audit_events` trail for the
 * platform, read through `private.platform_audit_events` (the table has no
 * direct reads). The database decides what each role sees: owner,
 * operations and support every event, billing only the billing actions
 * (`private.is_billing_audit_action`). The function returns ids; partner,
 * company, workspace and actor names are resolved here through what the
 * platform role already reads (partners, the admin lists of companies,
 * workspaces and users, partner members).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: string;
  occurred_at: Date;
  cursor_at: string;
  action: string;
  result: string;
  origin: string;
  actor_user_id: string | null;
  actor_principal_type: string;
  represented_user_id: string | null;
  organization_id: string | null;
  workspace_id: string | null;
  partner_id: string | null;
  resource_type: string;
  resource_id: string | null;
  client_id: string | null;
  request_id: string | null;
  metadata: unknown;
  is_security: boolean;
};

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function listPlatformAuditEvents(
  tx: ContextTransaction,
  role: PlatformAdminRoleKey | null,
  options: Readonly<{
    filters?: PlatformAuditFilters;
    cursor?: AuditCursor | null;
    limit?: number;
  }> = {},
): Promise<PlatformAuditPage> {
  requirePlatformPermission(role, Permissions.PLATFORM_AUDIT_READ);
  const filters = options.filters ?? EMPTY_AUDIT_FILTERS;
  const limit = Math.min(
    Math.max(options.limit ?? PLATFORM_AUDIT_PAGE, 1),
    199,
  );
  const period = periodBounds(filters);
  const cursor = options.cursor ?? null;

  const rows = await tx.$queryRaw<Row[]>`
    select id, occurred_at,
           to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
           action, result, origin, actor_user_id, actor_principal_type,
           represented_user_id, organization_id, workspace_id, partner_id,
           resource_type, resource_id, client_id, request_id, metadata,
           is_security
    from private.platform_audit_events(
      ${filters.partnerId}::uuid,
      ${filters.organizationId}::uuid,
      ${filters.workspaceId}::uuid,
      ${filters.action}::text,
      ${filters.result}::text,
      ${filters.origin}::text,
      ${filters.actorUserId}::uuid,
      ${period.from}::timestamptz,
      ${period.to}::timestamptz,
      ${cursor?.at ?? null}::timestamptz,
      ${cursor?.id ?? null}::uuid,
      ${limit + 1}::integer
    )
  `;
  const page = rows.slice(0, limit);
  const names = await resolveNames(tx, page);
  const last = page[page.length - 1];

  return {
    events: page.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      action: row.action,
      result: row.result as AuditResult,
      origin: row.origin,
      actorUserId: row.actor_user_id,
      actorName: row.actor_user_id
        ? (names.actors.get(row.actor_user_id) ?? null)
        : null,
      actorPrincipalType: row.actor_principal_type,
      representedUserId: row.represented_user_id,
      organizationId: row.organization_id,
      organizationName: row.organization_id
        ? (names.organizations.get(row.organization_id) ?? null)
        : null,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_id
        ? (names.workspaces.get(row.workspace_id) ?? null)
        : null,
      partnerId: row.partner_id,
      partnerName: row.partner_id
        ? (names.partners.get(row.partner_id) ?? null)
        : null,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      clientId: row.client_id,
      requestId: row.request_id,
      metadata: asMetadata(row.metadata),
      isSecurity: row.is_security,
    })),
    next:
      rows.length > limit && last
        ? encodeAuditCursor({ at: last.cursor_at, id: last.id })
        : null,
  };
}

function ids(values: ReadonlyArray<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => !!v && UUID.test(v)))];
}

async function resolveNames(tx: ContextTransaction, rows: readonly Row[]) {
  const partnerIds = ids(rows.map((r) => r.partner_id));
  const organizationIds = ids(rows.map((r) => r.organization_id));
  const workspaceIds = ids(rows.map((r) => r.workspace_id));
  const actorIds = ids(rows.map((r) => r.actor_user_id));

  // Each list is read only when needed, one query after the other (one
  // transaction).
  const partners =
    partnerIds.length > 0
      ? await tx.partner.findMany({
          where: { id: { in: partnerIds } },
          select: { id: true, name: true },
        })
      : [];
  const organizations =
    organizationIds.length > 0
      ? await tx.$queryRaw<Array<{ id: string; name: string }>>`
          select id, name from private.list_admin_organizations()
          where id = any(${organizationIds}::uuid[])
        `
      : [];
  const workspaces =
    workspaceIds.length > 0
      ? await tx.$queryRaw<Array<{ id: string; name: string }>>`
          select id, name from private.list_admin_workspaces()
          where id = any(${workspaceIds}::uuid[])
        `
      : [];
  const profiles =
    actorIds.length > 0
      ? await tx.$queryRaw<Array<{ id: string; full_name: string | null }>>`
          select id, full_name from private.list_admin_users()
          where id = any(${actorIds}::uuid[])
        `
      : [];
  const members =
    actorIds.length > 0
      ? await tx.partnerMember.findMany({
          where: { userId: { in: actorIds } },
          select: { userId: true, email: true },
        })
      : [];

  const actors = new Map<string, string>();
  for (const m of members) actors.set(m.userId, m.email);
  for (const p of profiles) if (p.full_name) actors.set(p.id, p.full_name);

  return {
    partners: new Map(partners.map((p) => [p.id, p.name])),
    organizations: new Map(organizations.map((o) => [o.id, o.name])),
    workspaces: new Map(workspaces.map((w) => [w.id, w.name])),
    actors,
  };
}

/** Choices of the filters: partners, companies and workspaces. */
export async function loadAuditFilterOptions(
  tx: ContextTransaction,
  role: PlatformAdminRoleKey | null,
): Promise<AuditFilterOptions> {
  requirePlatformPermission(role, Permissions.PLATFORM_AUDIT_READ);
  const partners = await tx.partner.findMany({
    orderBy: [{ isHouse: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  const organizations = await tx.$queryRaw<Array<{ id: string; name: string }>>`
    select id, name from private.list_admin_organizations() order by name
  `;
  const workspaces = await tx.$queryRaw<
    Array<{ id: string; name: string; organization_name: string }>
  >`
    select id, name, organization_name from private.list_admin_workspaces()
    order by organization_name, name
  `;
  return {
    partners,
    organizations,
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      organizationName: w.organization_name,
    })),
  };
}
