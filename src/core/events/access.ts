import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  isPartnerRole,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { ACCESS_REQUEST_JOB_KIND } from "./notices";

/**
 * Access to the data of events (H2, ADR 0022 item 7). The platform support
 * (owner, operations, support) or the partner (owner, admin, support) asks
 * the customer for the data of events of one workspace, with a reason and
 * the reference of the request; the owner or an admin of that workspace
 * approves (24 h to 7 days, 72 h by default), denies or revokes. Only the
 * requester reads, only the events of the request, each read audited as
 * `event.data.viewed` in the same database call. RLS repeats every rule.
 */

export const ACCESS_MIN_HOURS = 24;
export const ACCESS_MAX_HOURS = 168;
export const ACCESS_DEFAULT_HOURS = 72;
export const ACCESS_MAX_EVENTS = 50;

export type AccessRequester =
  | Readonly<{
      kind: "platform";
      userId: string;
      platformRole: PlatformAdminRoleKey | null;
    }>
  | Readonly<{
      kind: "partner";
      userId: string;
      partnerId: string;
      partnerRole: string | null;
    }>;

export type AccessGrantStatus =
  "pending" | "approved" | "denied" | "revoked" | "expired";

export type AccessGrant = Readonly<{
  id: string;
  requesterKind: "platform" | "partner";
  requesterLabel: string | null;
  requestedBy: string;
  workspaceId: string;
  workspaceName: string | null;
  eventIds: string[];
  reason: string;
  reference: string;
  durationHours: number;
  status: AccessGrantStatus;
  expiresAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}>;

function denied(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não tem permissão para esta ação.",
    messageKey: "eventRules.errors.forbidden",
  });
}

function invalid(key: string, message: string, values?: Record<string, number>) {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `eventRules.errors.${key}`,
    ...(values ? { messageValues: values } : {}),
  });
}

export function canRequestAccess(requester: AccessRequester): boolean {
  if (requester.kind === "platform") {
    return (
      requester.platformRole !== null &&
      hasPlatformRolePermission(
        requester.platformRole,
        Permissions.PLATFORM_EVENTS_REQUEST_ACCESS,
      )
    );
  }
  return (
    requester.partnerRole !== null &&
    isPartnerRole(requester.partnerRole) &&
    hasPartnerRolePermission(
      requester.partnerRole,
      Permissions.PARTNER_EVENTS_REQUEST_ACCESS,
    )
  );
}

export const AccessRequestInput = z.object({
  workspaceId: z.uuid(),
  organizationId: z.uuid(),
  eventIds: z.array(z.uuid()).min(1).max(ACCESS_MAX_EVENTS),
  reason: z.string().max(2000),
  reference: z.string().max(500),
  durationHours: z.number().int().optional(),
});
export type AccessRequestInput = z.infer<typeof AccessRequestInput>;

type GrantRow = Readonly<{
  id: string;
  requester_kind: "platform" | "partner";
  requester_label: string | null;
  requested_by: string;
  workspace_id: string;
  workspace_name: string | null;
  event_ids: string[];
  reason: string;
  reference: string;
  duration_hours: number;
  status: AccessGrantStatus;
  expires_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
}>;

const GRANT_COLUMNS = Prisma.sql`id, requester_kind, requester_label, requested_by, workspace_id,
  workspace_name, event_ids::text[] as event_ids, reason, reference, duration_hours, status,
  expires_at, decided_by, decided_at, created_at`;

function toGrant(row: GrantRow): AccessGrant {
  return {
    id: row.id,
    requesterKind: row.requester_kind,
    requesterLabel: row.requester_label,
    requestedBy: row.requested_by,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    eventIds: row.event_ids,
    reason: row.reason,
    reference: row.reference,
    durationHours: Number(row.duration_hours),
    status: row.status,
    expiresAt: row.expires_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/** Asks the customer for the data of events of one workspace. */
export async function requestEventAccess(
  tx: ContextTransaction,
  requester: AccessRequester,
  input: AccessRequestInput,
): Promise<AccessGrant> {
  if (!canRequestAccess(requester)) throw denied();
  const reason = input.reason.trim();
  const reference = input.reference.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw invalid("reason", "Escreva o motivo (de 10 a 500 caracteres).", {
      min: 10,
      max: 500,
    });
  }
  if (reference.length < 1 || reference.length > 120) {
    throw invalid("reference", "Informe a referência da solicitação.");
  }
  const hours = input.durationHours ?? ACCESS_DEFAULT_HOURS;
  if (hours < ACCESS_MIN_HOURS || hours > ACCESS_MAX_HOURS) {
    throw invalid("duration", "O prazo vai de 24 horas a 7 dias.");
  }
  const eventIds = [...new Set(input.eventIds)];
  let rows: GrantRow[];
  try {
    rows = await tx.$queryRaw<GrantRow[]>`
      insert into public.event_access_grants
        (requester_kind, partner_id, organization_id, workspace_id, event_ids,
         requested_by, reason, reference, duration_hours)
      values (${requester.kind},
              ${requester.kind === "partner" ? requester.partnerId : null}::uuid,
              ${input.organizationId}::uuid, ${input.workspaceId}::uuid,
              ${eventIds}::uuid[], ${requester.userId}::uuid, ${reason}, ${reference},
              ${hours})
      returning ${GRANT_COLUMNS}
    `;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      throw denied();
    }
    throw error;
  }
  const grant = toGrant(rows[0]!);
  // The worker emits the request's event (it holds the seal's key).
  await tx.$executeRaw`
    insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key, max_attempts)
    values (${ACCESS_REQUEST_JOB_KIND}, 'platform', ${requester.userId}::uuid,
            ${JSON.stringify({ grantId: grant.id })}::jsonb, ${`access:${grant.id}`}, 3)
  `;
  await recordAudit(tx, adminAuditContext(requester.userId), {
    action: "event.access.request",
    resourceType: "event_access_grant",
    resourceId: grant.id,
    result: "success",
    origin: "admin",
    metadata: {
      requesterKind: requester.kind,
      ...(requester.kind === "partner" ? { partnerId: requester.partnerId } : {}),
      workspaceId: input.workspaceId,
      count: eventIds.length,
      durationHours: hours,
    },
  });
  return grant;
}

/** The requester's own requests (newest first). */
export async function myAccessGrants(
  tx: ContextTransaction,
  userId: string,
  eventId?: string | null,
): Promise<AccessGrant[]> {
  const rows = await tx.$queryRaw<GrantRow[]>`
    select ${GRANT_COLUMNS} from public.event_access_grants
    where requested_by = ${userId}::uuid
      and (${eventId ?? null}::uuid is null or ${eventId ?? null}::uuid = any (event_ids))
    order by created_at desc limit 50
  `;
  return rows.map(toGrant);
}

/** The approved, unexpired grant of the requester for an event, if any. */
export function activeGrantFor(
  grants: readonly AccessGrant[],
  eventId: string,
  now: Date = new Date(),
): AccessGrant | null {
  return (
    grants.find(
      (grant) =>
        grant.status === "approved" &&
        grant.expiresAt !== null &&
        grant.expiresAt.getTime() > now.getTime() &&
        grant.eventIds.includes(eventId),
    ) ?? null
  );
}

/** The workspace's requests, for its owner and admins. */
export async function workspaceAccessGrants(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<AccessGrant[]> {
  const rows = await tx.$queryRaw<GrantRow[]>`
    select ${GRANT_COLUMNS} from public.event_access_grants
    where workspace_id = ${ctx.workspaceId}::uuid
    order by created_at desc limit 100
  `;
  return rows.map(toGrant);
}

export type AccessDecision = "approve" | "deny";

/** The owner or an admin approves (for up to the asked hours) or denies. */
export async function decideEventAccess(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: Readonly<{ grantId: string; decision: AccessDecision; hours?: number }>,
): Promise<AccessGrant> {
  if (!z.uuid().safeParse(input.grantId).success) throw notFoundGrant();
  const [current] = await tx.$queryRaw<GrantRow[]>`
    select ${GRANT_COLUMNS} from public.event_access_grants
    where id = ${input.grantId}::uuid and workspace_id = ${ctx.workspaceId}::uuid
  `;
  if (!current) throw notFoundGrant();
  if (current.status !== "pending") {
    throw invalid("notPending", "Este pedido já foi decidido.");
  }
  const hours = Math.min(
    input.hours ?? Number(current.duration_hours),
    Number(current.duration_hours),
  );
  if (input.decision === "approve" && hours < ACCESS_MIN_HOURS) {
    throw invalid("duration", "O prazo vai de 24 horas a 7 dias.");
  }
  const updated =
    input.decision === "approve"
      ? await tx.$executeRaw`
          update public.event_access_grants
          set status = 'approved', decided_by = ${ctx.userId}::uuid, decided_at = now(),
              expires_at = now() + make_interval(hours => ${hours}::int)
          where id = ${input.grantId}::uuid and status = 'pending'
        `
      : await tx.$executeRaw`
          update public.event_access_grants
          set status = 'denied', decided_by = ${ctx.userId}::uuid, decided_at = now()
          where id = ${input.grantId}::uuid and status = 'pending'
        `;
  if (updated === 0) throw denied();
  await tx.$executeRaw`select private.event_access_sync(${input.grantId}::uuid)`;
  await recordAudit(tx, ctx, {
    action:
      input.decision === "approve"
        ? "event.access.approve"
        : "event.access.deny",
    resourceType: "event_access_grant",
    resourceId: input.grantId,
    result: "success",
    origin: "app",
    metadata: {
      requesterKind: current.requester_kind,
      ...(input.decision === "approve" ? { durationHours: hours } : {}),
      count: current.event_ids.length,
    },
  });
  const [row] = await tx.$queryRaw<GrantRow[]>`
    select ${GRANT_COLUMNS} from public.event_access_grants where id = ${input.grantId}::uuid
  `;
  return toGrant(row!);
}

/** The customer revokes an approved grant at any time. */
export async function revokeEventAccess(
  tx: ContextTransaction,
  ctx: RequestContext,
  grantId: string,
): Promise<void> {
  if (!z.uuid().safeParse(grantId).success) throw notFoundGrant();
  const updated = await tx.$executeRaw`
    update public.event_access_grants
    set status = 'revoked', revoked_by = ${ctx.userId}::uuid, revoked_at = now()
    where id = ${grantId}::uuid and workspace_id = ${ctx.workspaceId}::uuid
      and status = 'approved'
  `;
  if (updated === 0) throw notFoundGrant();
  await recordAudit(tx, ctx, {
    action: "event.access.revoke",
    resourceType: "event_access_grant",
    resourceId: grantId,
    result: "success",
    origin: "app",
    metadata: {},
  });
}

/** The requester withdraws a request or ends a grant. */
export async function withdrawEventAccess(
  tx: ContextTransaction,
  userId: string,
  grantId: string,
): Promise<void> {
  if (!z.uuid().safeParse(grantId).success) throw notFoundGrant();
  const updated = await tx.$executeRaw`
    update public.event_access_grants
    set status = 'revoked', revoked_by = ${userId}::uuid, revoked_at = now()
    where id = ${grantId}::uuid and requested_by = ${userId}::uuid
      and status in ('pending', 'approved')
  `;
  if (updated === 0) throw notFoundGrant();
  await tx.$executeRaw`select private.event_access_sync(${grantId}::uuid)`;
  await recordAudit(tx, adminAuditContext(userId), {
    action: "event.access.withdraw",
    resourceType: "event_access_grant",
    resourceId: grantId,
    result: "success",
    origin: "admin",
    metadata: {},
  });
}

function notFoundGrant(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Pedido de acesso não encontrado.",
    messageKey: "eventRules.errors.grantNotFound",
  });
}

/**
 * The data of an event with an approved grant: the database checks the
 * grant and the role again and records `event.data.viewed` (visible to the
 * customer) in the same call.
 */
export async function readEventDataByGrant(
  tx: ContextTransaction,
  requester: AccessRequester,
  input: Readonly<{ eventId: string; ip: string | null }>,
): Promise<unknown> {
  if (!canRequestAccess(requester)) throw denied();
  if (!z.uuid().safeParse(input.eventId).success) throw denied();
  let rows: { data: Prisma.JsonValue | null }[];
  try {
    rows = await tx.$queryRaw`
      select private.read_event_data_by_grant(${input.eventId}::uuid, ${input.ip}) as data
    `;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      throw denied();
    }
    throw error;
  }
  const data = rows[0]?.data ?? null;
  if (data === null) throw denied();
  return data;
}
