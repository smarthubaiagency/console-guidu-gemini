import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  EVENT_MODULES,
  EVENT_SEVERITIES,
  EVENT_STATUSES,
  type EventSeverity,
  type EventStatus,
} from "./catalog";

/**
 * Eventos of the workspace (/app), of the partner (/admin) and the trace of
 * an event for every level (H2, gap "Rastro completo de um evento"): what
 * happened, who was told, on which channel and with which outcome (the
 * bell included), to which subscribers it was handed over (H4), what was
 * audited and who saw the data with a grant. The
 * workspace reads `public.events` (members, customer events); the partner
 * reads `private.partner_events`; the trace comes from security definer
 * functions that cut by level (the platform never sees the people, the
 * customer never sees the `keychain` openings).
 */

export const EventListFilters = z.object({
  module: z
    .string()
    .max(48)
    .refine((value) => EVENT_MODULES.includes(value))
    .optional()
    .catch(undefined),
  severity: z.enum(EVENT_SEVERITIES).optional().catch(undefined),
  status: z.enum(EVENT_STATUSES).optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
});
export type EventListFilters = z.infer<typeof EventListFilters>;

export type EventListRow = Readonly<{
  id: string;
  type: string;
  module: string;
  severity: EventSeverity;
  status: EventStatus;
  organizationId: string | null;
  organizationName: string | null;
  workspaceId: string | null;
  occurredAt: Date;
  contentHash: string;
  /** Null where the reader sees only the situation. */
  data: Record<string, unknown> | null;
}>;

type WorkspaceRow = Readonly<{
  id: string;
  type: string;
  module: string;
  severity: EventSeverity;
  status: EventStatus;
  organization_id: string | null;
  workspace_id: string | null;
  occurred_at: Date;
  content_hash: string;
  data: Record<string, unknown> | null;
}>;

function toRow(
  row: WorkspaceRow,
  names?: ReadonlyMap<string, string>,
): EventListRow {
  return {
    id: row.id,
    type: row.type,
    module: row.module,
    severity: row.severity,
    status: row.status,
    organizationId: row.organization_id,
    organizationName: row.organization_id
      ? (names?.get(row.organization_id) ?? null)
      : null,
    workspaceId: row.workspace_id,
    occurredAt: row.occurred_at,
    contentHash: row.content_hash,
    data: row.data,
  };
}

/** The workspace's events (every member; customer events only, by RLS). */
export async function listWorkspaceEvents(
  tx: ContextTransaction,
  ctx: RequestContext,
  filters: EventListFilters,
  limit = 100,
): Promise<EventListRow[]> {
  const rows = await tx.$queryRaw<WorkspaceRow[]>`
    select id, type, module, severity, status, organization_id, workspace_id,
           occurred_at, content_hash, data
    from public.events
    where workspace_id = ${ctx.workspaceId}::uuid
      and 'customer' = any (audiences)
      and (${filters.module ?? null}::text is null or module = ${filters.module ?? null})
      and (${filters.severity ?? null}::text is null or severity = ${filters.severity ?? null})
      and (${filters.status ?? null}::text is null or status = ${filters.status ?? null})
    order by occurred_at desc, id desc
    limit ${Math.min(Math.max(limit, 1), 200)}
  `;
  return rows.map((row) => toRow(row));
}

/** The partner's events: the data only where it manages (the function says). */
export async function listPartnerEvents(
  tx: ContextTransaction,
  partnerId: string,
  filters: EventListFilters,
): Promise<EventListRow[]> {
  const rows = await tx.$queryRaw<WorkspaceRow[]>`
    select id, type, module, severity, status, organization_id, workspace_id,
           occurred_at, content_hash, data
    from private.partner_events(null, 200)
  `;
  const orgs = await tx.$queryRaw<{ id: string; name: string }[]>`
    select id, name from public.organizations where partner_id = ${partnerId}::uuid
  `;
  const names = new Map(orgs.map((org) => [org.id, org.name]));
  return rows
    .filter(
      (row) =>
        (!filters.module || row.module === filters.module) &&
        (!filters.severity || row.severity === filters.severity) &&
        (!filters.status || row.status === filters.status) &&
        (!filters.customer || row.organization_id === filters.customer),
    )
    .map((row) => toRow(row, names));
}

export type TraceDelivery = Readonly<{
  id: string;
  channel: string;
  status: string;
  reason: string | null;
  provider: string | null;
  attempts: number;
  holdReason: string | null;
  deliverAfter: Date | null;
  recipientUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type TraceAudit = Readonly<{
  id: string;
  occurredAt: Date;
  action: string;
  result: string;
  origin: string;
  actorUserId: string | null;
  accessGrantId: string | null;
}>;

export type TraceView = Readonly<{
  viewedAt: Date;
  requesterKind: "platform" | "partner";
  requesterLabel: string | null;
  requestedBy: string;
  decidedBy: string | null;
  accessGrantId: string;
}>;

/** A hand-off of the event to a subscriber (H4): situation only. */
export type TraceHandoff = Readonly<{
  id: string;
  subscriber: string;
  module: string;
  status: "queued" | "done" | "failed" | "skipped";
  reason: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}>;

export type EventTrace = Readonly<{
  viewer: "customer" | "partner" | "partner_situation" | "platform" | null;
  deliveries: TraceDelivery[];
  handoffs: TraceHandoff[];
  audit: TraceAudit[];
  views: TraceView[];
}>;

/** The trace of an event as the caller's level may see it. */
export async function eventTrace(
  tx: ContextTransaction,
  eventId: string,
): Promise<EventTrace> {
  const none: EventTrace = {
    viewer: null,
    deliveries: [],
    handoffs: [],
    audit: [],
    views: [],
  };
  if (!z.uuid().safeParse(eventId).success) return none;
  const [viewer] = await tx.$queryRaw<{ viewer: EventTrace["viewer"] }[]>`
    select private.event_trace_viewer(${eventId}::uuid) as viewer
  `;
  if (!viewer?.viewer) return none;
  const deliveries = await tx.$queryRaw<
    {
      id: string;
      channel: string;
      status: string;
      reason: string | null;
      provider: string | null;
      attempts: number;
      hold_reason: string | null;
      deliver_after: Date | null;
      recipient_user_id: string | null;
      created_at: Date;
      updated_at: Date;
    }[]
  >`select * from private.event_trace_deliveries(${eventId}::uuid)`;
  const handoffs = await tx.$queryRaw<
    {
      id: string;
      subscriber: string;
      module: string;
      status: TraceHandoff["status"];
      reason: string | null;
      attempts: number;
      created_at: Date;
      updated_at: Date;
      finished_at: Date | null;
    }[]
  >`select * from private.event_trace_handoffs(${eventId}::uuid)`;
  const audit = await tx.$queryRaw<
    {
      id: string;
      occurred_at: Date;
      action: string;
      result: string;
      origin: string;
      actor_user_id: string | null;
      access_grant_id: string | null;
    }[]
  >`select * from private.event_trace_audit(${eventId}::uuid)`;
  const views = await tx.$queryRaw<
    {
      viewed_at: Date;
      requester_kind: "platform" | "partner";
      requester_label: string | null;
      requested_by: string;
      decided_by: string | null;
      access_grant_id: string;
    }[]
  >`select * from private.event_data_views(${eventId}::uuid)`;
  return {
    viewer: viewer.viewer,
    deliveries: deliveries.map((d) => ({
      id: d.id,
      channel: d.channel,
      status: d.status,
      reason: d.reason,
      provider: d.provider,
      attempts: Number(d.attempts),
      holdReason: d.hold_reason,
      deliverAfter: d.deliver_after,
      recipientUserId: d.recipient_user_id,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
    handoffs: handoffs.map((h) => ({
      id: h.id,
      subscriber: h.subscriber,
      module: h.module,
      status: h.status,
      reason: h.reason,
      attempts: Number(h.attempts),
      createdAt: h.created_at,
      updatedAt: h.updated_at,
      finishedAt: h.finished_at,
    })),
    audit: audit.map((a) => ({
      id: a.id,
      occurredAt: a.occurred_at,
      action: a.action,
      result: a.result,
      origin: a.origin,
      actorUserId: a.actor_user_id,
      accessGrantId: a.access_grant_id,
    })),
    views: views.map((v) => ({
      viewedAt: v.viewed_at,
      requesterKind: v.requester_kind,
      requesterLabel: v.requester_label,
      requestedBy: v.requested_by,
      decidedBy: v.decided_by,
      accessGrantId: v.access_grant_id,
    })),
  };
}

export const SETTABLE_STATUSES = ["open", "resolved", "dismissed"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

/**
 * Resolved, dismissed or open again; the database decides who may (the
 * customer's owner and admins, the partner managers, the platform for its
 * own events) and the change is audited.
 */
export async function setEventStatus(
  tx: ContextTransaction,
  actor: Readonly<{ userId: string; ctx?: RequestContext | null }>,
  eventId: string,
  status: SettableStatus,
): Promise<void> {
  if (!z.uuid().safeParse(eventId).success) throw notAllowed();
  let rows: { changed: boolean }[];
  try {
    rows = await tx.$queryRaw`
      select private.set_event_status(${eventId}::uuid, ${status}) as changed
    `;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError)
      throw notAllowed();
    throw error;
  }
  if (!rows[0]?.changed) throw notAllowed();
  await recordAudit(tx, actor.ctx ?? adminAuditContext(actor.userId), {
    action: "event.status.change",
    resourceType: "event",
    resourceId: eventId,
    result: "success",
    origin: actor.ctx ? "app" : "admin",
    metadata: { eventId, status },
  });
}

function notAllowed(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não pode mudar a situação deste evento.",
    messageKey: "eventRules.errors.status",
  });
}
