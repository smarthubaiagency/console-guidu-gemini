import "server-only";

import { recordAudit } from "@/core/audit/record";
import { type EventActor, emitEvent } from "@/core/events/emit";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import {
  consoleUrlOf,
  decisionOutcome,
  type DecisionOutcome,
  requestSituation,
  type ServiceModeDecision,
  serviceModeError,
  serviceModeFailure,
  type ServiceModeRequester,
  type ServiceModeRequestStatus,
  settingsUrlOf,
  tokenHashOf,
  trimOrigin,
} from "./requests";

export { consoleUrlOf, linkUrlOf, settingsUrlOf } from "./requests";

/**
 * Service modes of a company, complete (GB1c, ADR 0020):
 * - the partner (or GUIDU, for the direct customers) asks to move a company
 *   to `gerenciado`; the owner receives a single-use link by e-mail (the
 *   `events.dispatch` of `service_mode.change_requested` writes the token)
 *   and approves or denies on a public page, or inside /app;
 * - the owner goes back to `padrao` alone, at any time, in Configurações ›
 *   Modo de serviço; the managing team loses access on the next query.
 * The database functions (`private.service_mode_request_*`) check who may
 * do what and keep the proof (who, when, how, IP, user agent); every step
 * is audited and leaves an event of the Central de Eventos.
 */

export type ServiceModeActor = Readonly<{
  userId: string;
  via: ServiceModeRequester;
}>;

export type DecisionMeta = Readonly<{
  ip: string | null;
  userAgent: string | null;
}>;

function eventActor(userId: string, origin: EventActor["origin"]): EventActor {
  return { userId, principalType: "user", origin };
}

async function rethrow<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw serviceModeError(error) ?? error;
  }
}

// ---------------------------------------------------------------------------
// Request (partner or platform)
// ---------------------------------------------------------------------------

type CreatedRow = {
  request_id: string;
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  organization_name: string;
  partner_id: string;
  partner_name: string;
  recipient_user_id: string;
  expires_at: Date;
};

/**
 * Asks the owner of a company to move it to `gerenciado`. Runs in the
 * partner's (or the platform's) identity context of the request host;
 * `origin` is that host, where the link and the screens live.
 */
export async function requestManagedMode(
  tx: ContextTransaction,
  actor: ServiceModeActor,
  organizationId: string,
  origin: string,
): Promise<{ requestId: string; expiresAt: Date }> {
  const [row] = await rethrow(
    tx.$queryRaw<CreatedRow[]>`
      select * from private.service_mode_request_create(${organizationId}::uuid, ${actor.via})
    `,
  );
  if (!row) throw serviceModeFailure("not_found");
  await emitEvent(tx, {
    type: "service_mode.change_requested",
    actor: eventActor(actor.userId, actor.via === "platform" ? "admin" : "app"),
    partnerId: row.partner_id,
    organizationId,
    workspaceId: row.workspace_id,
    subject: { type: "service_mode_request", id: row.request_id },
    data: {
      requestId: row.request_id,
      organizationName: row.organization_name,
      partnerName: row.partner_name,
      workspaceName: row.workspace_name,
      requestedVia: actor.via,
      expiresAt: new Date(row.expires_at).toISOString(),
      baseUrl: trimOrigin(origin),
      settingsUrl: settingsUrlOf(origin, row.workspace_slug),
      consoleUrl: consoleUrlOf(origin, actor.via),
    },
    idempotencyKey: `service_mode.request:${row.request_id}`,
  });
  return { requestId: row.request_id, expiresAt: new Date(row.expires_at) };
}

/** Cancels a pending request of the side that asked. */
export async function cancelManagedModeRequest(
  tx: ContextTransaction,
  actor: ServiceModeActor,
  requestId: string,
): Promise<void> {
  const [row] = await rethrow(
    tx.$queryRaw<{ done: boolean }[]>`
      select private.service_mode_request_cancel(${requestId}::uuid, ${actor.via}) as done
    `,
  );
  if (!row?.done) throw serviceModeFailure("not_found");
}

// ---------------------------------------------------------------------------
// Decision (public link or /app)
// ---------------------------------------------------------------------------

export type LinkRequestView = Readonly<{
  requestId: string;
  status: ServiceModeRequestStatus;
  expiresAt: Date;
  createdAt: Date;
  decidedAt: Date | null;
  requestedVia: ServiceModeRequester;
  organizationName: string;
  workspaceName: string;
  partnerName: string;
}>;

/**
 * The request of a secure link, for the public page of the host's partner
 * (`withPartnerContext`). Null for an unknown token or another partner's.
 */
export async function readRequestByToken(
  tx: ContextTransaction,
  rawToken: string,
): Promise<LinkRequestView | null> {
  const hash = tokenHashOf(rawToken);
  if (!hash) return null;
  const [row] = await tx.$queryRaw<
    {
      request_id: string;
      status: string;
      expires_at: Date;
      created_at: Date;
      decided_at: Date | null;
      requested_via: string;
      organization_name: string | null;
      workspace_name: string | null;
      partner_name: string | null;
    }[]
  >`select * from private.service_mode_request_by_token(${hash})`;
  if (!row) return null;
  return {
    requestId: row.request_id,
    status: requestSituation(row.status, new Date(row.expires_at)),
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    decidedAt: row.decided_at ? new Date(row.decided_at) : null,
    requestedVia: row.requested_via === "platform" ? "platform" : "partner",
    organizationName: row.organization_name ?? "",
    workspaceName: row.workspace_name ?? "",
    partnerName: row.partner_name ?? "",
  };
}

type DecideRow = {
  outcome: string;
  request_id: string | null;
  organization_id: string | null;
  workspace_id: string | null;
  workspace_slug: string | null;
  partner_id: string | null;
  decided_by: string | null;
  requested_by: string | null;
};

async function afterDecision(
  tx: ContextTransaction,
  row: DecideRow,
  outcome: DecisionOutcome,
  origin: string,
): Promise<void> {
  if (
    (outcome !== "approved" && outcome !== "denied") ||
    !row.request_id ||
    !row.organization_id ||
    !row.workspace_id ||
    !row.partner_id ||
    !row.decided_by
  ) {
    return;
  }
  const requestedVia: ServiceModeRequester =
    row.partner_id === HOUSE_PARTNER_ID ? "platform" : "partner";
  await emitEvent(tx, {
    type:
      outcome === "approved"
        ? "service_mode.changed"
        : "service_mode.change_denied",
    actor: eventActor(row.decided_by, "app"),
    partnerId: row.partner_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    subject: { type: "service_mode_request", id: row.request_id },
    data: {
      requestId: row.request_id,
      from: "padrao",
      to: outcome === "approved" ? "gerenciado" : "padrao",
      reason: outcome === "approved" ? "request_approved" : "request_denied",
      ...(row.workspace_slug
        ? { settingsUrl: settingsUrlOf(origin, row.workspace_slug) }
        : {}),
      consoleUrl: consoleUrlOf(origin, requestedVia),
    },
    idempotencyKey: `service_mode.decision:${row.request_id}`,
  });
}

/**
 * Decides by the secure link (single use). The decision is the recipient
 * owner's; the page runs in the host partner's context, without a session.
 */
export async function decideByToken(
  tx: ContextTransaction,
  rawToken: string,
  decision: ServiceModeDecision,
  meta: DecisionMeta,
  origin: string,
): Promise<DecisionOutcome> {
  const hash = tokenHashOf(rawToken);
  if (!hash) return "not_found";
  const [row] = await tx.$queryRaw<DecideRow[]>`
    select * from private.service_mode_request_decide(
      ${hash}, null::uuid, ${decision}, ${meta.ip}::inet, ${meta.userAgent}
    )
  `;
  const outcome = decisionOutcome(row?.outcome);
  if (row) await afterDecision(tx, row, outcome, origin);
  return outcome;
}

/** Decides inside /app, as an active owner of the context company. */
export async function decideInApp(
  tx: ContextTransaction,
  ctx: RequestContext,
  requestId: string,
  decision: ServiceModeDecision,
  meta: DecisionMeta,
  origin: string,
): Promise<DecisionOutcome> {
  const [row] = await tx.$queryRaw<DecideRow[]>`
    select * from private.service_mode_request_decide(
      null, ${requestId}::uuid, ${decision}, ${meta.ip}::inet, ${meta.userAgent}
    )
  `;
  const outcome = decisionOutcome(row?.outcome);
  if (row && row.organization_id === ctx.organizationId) {
    await afterDecision(tx, row, outcome, origin);
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Back to `padrao` (the company owner)
// ---------------------------------------------------------------------------

async function isCompanyOwner(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<boolean> {
  const member = await tx.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
      },
    },
    select: { role: true, status: true },
  });
  return member?.role === "owner" && member.status === "active";
}

/**
 * The owner moves the company back to `padrao`. The access of the managing
 * team ends with this transaction; the partner hears through the event.
 */
export async function revertToStandard(
  tx: ContextTransaction,
  ctx: RequestContext,
  workspaceSlug: string,
  origin: string,
): Promise<void> {
  if (!(await isCompanyOwner(tx, ctx))) throw serviceModeFailure("forbidden");
  const current = await tx.organizationServiceMode.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { mode: true, partnerId: true },
  });
  if (current?.mode !== "gerenciado") {
    throw serviceModeFailure("not_found");
  }
  const updated = await tx.organizationServiceMode.updateMany({
    where: { organizationId: ctx.organizationId, mode: "gerenciado" },
    data: {
      mode: "padrao",
      source: "customer",
      requestId: null,
      setBy: ctx.userId,
    },
  });
  if (updated.count === 0) throw serviceModeFailure("not_found");
  await recordAudit(tx, ctx, {
    action: "service_mode.reverted",
    resourceType: "organization",
    resourceId: ctx.organizationId,
    result: "success",
    origin: "app",
    metadata: {
      from: "gerenciado",
      to: "padrao",
      partnerId: current.partnerId,
    },
  });
  const via: ServiceModeRequester =
    current.partnerId === HOUSE_PARTNER_ID ? "platform" : "partner";
  await emitEvent(tx, {
    type: "service_mode.changed",
    actor: eventActor(ctx.userId, "app"),
    partnerId: current.partnerId,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    subject: { type: "organization_service_mode", id: ctx.organizationId },
    data: {
      from: "gerenciado",
      to: "padrao",
      reason: "customer_reverted",
      settingsUrl: settingsUrlOf(origin, workspaceSlug),
      consoleUrl: consoleUrlOf(origin, via),
    },
    idempotencyKey: `service_mode.revert:${ctx.organizationId}:${Date.now()}`,
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ServiceModeRequestView = Readonly<{
  id: string;
  organizationId: string;
  situation: ServiceModeRequestStatus;
  requestedVia: ServiceModeRequester;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedVia: string | null;
}>;

type RequestRow = {
  id: string;
  organizationId: string;
  status: string;
  requestedVia: string;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedVia: string | null;
};

const REQUEST_SELECT = {
  id: true,
  organizationId: true,
  status: true,
  requestedVia: true,
  createdAt: true,
  expiresAt: true,
  decidedAt: true,
  decidedVia: true,
} as const;

function toRequestView(row: RequestRow, now: Date): ServiceModeRequestView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    situation: requestSituation(row.status, row.expiresAt, now),
    requestedVia: row.requestedVia === "platform" ? "platform" : "partner",
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    decidedVia: row.decidedVia,
  };
}

/** The latest request of each company (RLS decides which are visible). */
export async function latestRequests(
  tx: ContextTransaction,
  organizationIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, ServiceModeRequestView>> {
  if (organizationIds.length === 0) return new Map();
  const rows = await tx.serviceModeRequest.findMany({
    where: { organizationId: { in: [...organizationIds] } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: REQUEST_SELECT,
  });
  const latest = new Map<string, ServiceModeRequestView>();
  for (const row of rows) {
    if (!latest.has(row.organizationId)) {
      latest.set(row.organizationId, toRequestView(row, now));
    }
  }
  return latest;
}

export type WorkspaceServiceMode = Readonly<{
  mode: "padrao" | "gerenciado";
  source: string | null;
  since: Date | null;
  partnerName: string | null;
  requestedVia: ServiceModeRequester;
  /** The pending request, still within its 7 days. */
  pending: ServiceModeRequestView | null;
  /** Owner of the company: decides and goes back to `padrao`. */
  canManage: boolean;
}>;

/** The card of Configurações › Modo de serviço (members read). */
export async function readWorkspaceServiceMode(
  tx: ContextTransaction,
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<WorkspaceServiceMode> {
  const [row, requests, owner, organization] = await Promise.all([
    tx.organizationServiceMode.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { mode: true, source: true, updatedAt: true, partnerId: true },
    }),
    latestRequests(tx, [ctx.organizationId], now),
    isCompanyOwner(tx, ctx),
    tx.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { partnerId: true },
    }),
  ]);
  const partnerId = row?.partnerId ?? organization?.partnerId ?? null;
  const partner = partnerId
    ? await tx.partner.findUnique({
        where: { id: partnerId },
        select: { name: true },
      })
    : null;
  const latest = requests.get(ctx.organizationId) ?? null;
  const mode = row?.mode === "gerenciado" ? "gerenciado" : "padrao";
  return {
    mode,
    source: row?.source ?? null,
    since: row ? row.updatedAt : null,
    partnerName: partner?.name ?? null,
    requestedVia: partnerId === HOUSE_PARTNER_ID ? "platform" : "partner",
    pending:
      mode === "padrao" && latest?.situation === "pending" ? latest : null,
    canManage: owner,
  };
}

export type PlatformServiceMode = Readonly<{
  organizationId: string;
  mode: "padrao" | "gerenciado";
  request: Readonly<{
    id: string;
    situation: ServiceModeRequestStatus;
    expiresAt: Date;
  }> | null;
}>;

/** Modes and latest request of GUIDU's direct customers. */
export async function platformServiceModes(
  tx: ContextTransaction,
  now: Date = new Date(),
): Promise<Map<string, PlatformServiceMode>> {
  const rows = await tx.$queryRaw<
    {
      organization_id: string;
      mode: string;
      request_id: string | null;
      request_status: string | null;
      request_expires_at: Date | null;
    }[]
  >`select * from private.platform_service_modes()`;
  return new Map(
    rows.map((row) => [
      row.organization_id,
      {
        organizationId: row.organization_id,
        mode: row.mode === "gerenciado" ? "gerenciado" : "padrao",
        request:
          row.request_id && row.request_status && row.request_expires_at
            ? {
                id: row.request_id,
                situation: requestSituation(
                  row.request_status,
                  new Date(row.request_expires_at),
                  now,
                ),
                expiresAt: new Date(row.request_expires_at),
              }
            : null,
      },
    ]),
  );
}
