import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { Permissions } from "@/core/permissions/catalog";
import {
  hasCapabilityPermission,
  hasPlatformRolePermission,
  type PlatformAdminRoleKey,
  type PlatformCapability,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  EVENT_MODULES,
  EVENT_SEVERITIES,
  EVENT_STATUSES,
  isEventType,
} from "./catalog";
import { type SealCheck, sealKeys } from "./seal";
import { verifyPresentedData } from "./verify";

/**
 * The Event Hub seen by the platform (H1): the situation of every event
 * (type, ids, moment, seal, verification, deliveries) without its data,
 * through `private.platform_events` and `private.event_deliveries`; the
 * data only with `keychain` (`private.read_event_data`, which checks the
 * capability and records the audit in the same call); and the owner's
 * grant of the capability. Runs as app_runtime in `withIdentityContext`;
 * the database repeats every check.
 */

export type PlatformEventsActor = Readonly<{
  userId: string;
  platformRole: PlatformAdminRoleKey | null;
}>;

function denied(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não tem permissão para esta ação.",
    messageKey: "events.errors.forbidden",
  });
}

export function canReadEvents(actor: PlatformEventsActor): boolean {
  return (
    actor.platformRole !== null &&
    hasPlatformRolePermission(
      actor.platformRole,
      Permissions.PLATFORM_EVENTS_READ,
    )
  );
}

function requireReader(actor: PlatformEventsActor): void {
  if (!canReadEvents(actor)) throw denied();
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const PlatformEventFilters = z.object({
  type: z
    .string()
    .max(80)
    .refine((value) => isEventType(value))
    .optional()
    .catch(undefined),
  module: z
    .string()
    .max(48)
    .refine((value) => EVENT_MODULES.includes(value))
    .optional()
    .catch(undefined),
  partner: z.uuid().optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
  from: z.string().regex(DAY).optional().catch(undefined),
  to: z.string().regex(DAY).optional().catch(undefined),
  // H2: severity and status, filtered over the page read.
  severity: z.enum(EVENT_SEVERITIES).optional().catch(undefined),
  status: z.enum(EVENT_STATUSES).optional().catch(undefined),
});
export type PlatformEventFilters = z.infer<typeof PlatformEventFilters>;

export type PlatformEventRow = Readonly<{
  id: string;
  type: string;
  module: string;
  level: string;
  severity: string;
  status: string;
  route: string;
  partnerId: string | null;
  partnerName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  subjectType: string | null;
  subjectId: string | null;
  createdBy: string | null;
  occurredAt: Date;
  chainKey: string;
  seq: number;
  contentHash: string;
  prevHash: string | null;
  keyVersion: string;
  chainOk: boolean;
  dispatchedAt: Date | null;
  verifiedAt: Date | null;
  integrity: string | null;
  deliveries: number;
  failedDeliveries: number;
}>;

type RawRow = Readonly<{
  id: string;
  type: string;
  module: string;
  level: string;
  severity: string;
  status: string;
  route: string;
  partner_id: string | null;
  partner_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  subject_type: string | null;
  subject_id: string | null;
  created_by: string | null;
  occurred_at: Date;
  chain_key: string;
  seq: bigint | number;
  content_hash: string;
  prev_hash: string | null;
  key_version: string;
  chain_ok: boolean | null;
  dispatched_at: Date | null;
  verified_at: Date | null;
  integrity: string | null;
  deliveries: number;
  failed_deliveries: number;
}>;

function toRow(row: RawRow): PlatformEventRow {
  return {
    id: row.id,
    type: row.type,
    module: row.module,
    level: row.level,
    severity: row.severity,
    status: row.status,
    route: row.route,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    createdBy: row.created_by,
    occurredAt: row.occurred_at,
    chainKey: row.chain_key,
    seq: Number(row.seq),
    contentHash: row.content_hash,
    prevHash: row.prev_hash,
    keyVersion: row.key_version,
    chainOk: row.chain_ok === true,
    dispatchedAt: row.dispatched_at,
    verifiedAt: row.verified_at,
    integrity: row.integrity,
    deliveries: Number(row.deliveries),
    failedDeliveries: Number(row.failed_deliveries),
  };
}

/** Start of a calendar day in Brasília (UTC-3), as the screen shows dates. */
function dayStart(day: string | undefined, plusDays = 0): Date | null {
  if (!day) return null;
  const date = new Date(`${day}T03:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + plusDays * 86_400_000);
}

async function queryEvents(
  tx: ContextTransaction,
  filters: PlatformEventFilters,
  eventId: string | null,
  limit: number,
): Promise<PlatformEventRow[]> {
  const rows = await tx.$queryRaw<RawRow[]>`
    select * from private.platform_events(
      ${filters.type ?? null}::text, ${filters.module ?? null}::text,
      ${filters.partner ?? null}::uuid, ${filters.customer ?? null}::uuid,
      ${dayStart(filters.from)}::timestamptz, ${dayStart(filters.to, 1)}::timestamptz,
      ${eventId}::uuid, ${limit}::integer
    )
  `;
  return rows.map(toRow);
}

export async function listPlatformEvents(
  tx: ContextTransaction,
  actor: PlatformEventsActor,
  filters: PlatformEventFilters,
  limit = 100,
): Promise<PlatformEventRow[]> {
  requireReader(actor);
  const narrowed = Boolean(filters.severity || filters.status);
  const rows = await queryEvents(tx, filters, null, narrowed ? 200 : limit);
  return rows
    .filter(
      (row) =>
        (!filters.severity || row.severity === filters.severity) &&
        (!filters.status || row.status === filters.status),
    )
    .slice(0, limit);
}

export type DeliverySituation = Readonly<{
  id: string;
  channel: string;
  status: string;
  reason: string | null;
  provider: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type PlatformEventDetail = PlatformEventRow &
  Readonly<{ deliveryList: readonly DeliverySituation[] }>;

export async function platformEventDetail(
  tx: ContextTransaction,
  actor: PlatformEventsActor,
  eventId: string,
): Promise<PlatformEventDetail | null> {
  requireReader(actor);
  if (!z.uuid().safeParse(eventId).success) return null;
  const [row] = await queryEvents(tx, {}, eventId, 1);
  if (!row) return null;
  const deliveries = await tx.$queryRaw<
    {
      id: string;
      channel: string;
      status: string;
      reason: string | null;
      provider: string | null;
      attempts: number;
      created_at: Date;
      updated_at: Date;
    }[]
  >`select * from private.event_deliveries(${eventId}::uuid)`;
  return {
    ...row,
    deliveryList: deliveries.map((d) => ({
      id: d.id,
      channel: d.channel,
      status: d.status,
      reason: d.reason,
      provider: d.provider,
      attempts: Number(d.attempts),
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Capabilities (`keychain`)
// ---------------------------------------------------------------------------

/** The capabilities of the person (their own rows). */
export async function myCapabilities(
  tx: ContextTransaction,
  userId: string,
): Promise<PlatformCapability[]> {
  const rows = await tx.$queryRaw<{ capability: string }[]>`
    select capability from public.platform_admin_capabilities
    where user_id = ${userId}::uuid
  `;
  return rows
    .map((row) => row.capability)
    .filter((c): c is PlatformCapability => c === "keychain");
}

export function canReadAllData(
  actor: PlatformEventsActor,
  capabilities: readonly PlatformCapability[],
): boolean {
  return (
    actor.platformRole !== null &&
    hasCapabilityPermission(
      capabilities,
      Permissions.PLATFORM_EVENTS_READ_ALL_DATA,
    )
  );
}

export const MIN_REASON = 10;
export const MAX_REASON = 500;

/**
 * The data of an event, with `keychain`, a reason and MFA (checked by the
 * caller). The database checks the capability and the reason again and
 * records `platform.event.view_data` in the platform's audit in the same
 * call; the customer is not told (Marcelo, 16/10/2026).
 */
export async function readEventData(
  tx: ContextTransaction,
  actor: PlatformEventsActor,
  input: Readonly<{ eventId: string; reason: string; ip: string | null }>,
): Promise<unknown> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: `Escreva o motivo (de ${MIN_REASON} a ${MAX_REASON} caracteres).`,
      messageKey: "events.errors.reason",
      messageValues: { min: MIN_REASON, max: MAX_REASON },
    });
  }
  if (!z.uuid().safeParse(input.eventId).success) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Evento não encontrado.",
      messageKey: "events.errors.notFound",
    });
  }
  if (!canReadAllData(actor, await myCapabilities(tx, actor.userId))) {
    throw denied();
  }
  let rows: { data: Prisma.JsonValue | null }[];
  try {
    rows = await tx.$queryRaw`
      select private.read_event_data(${input.eventId}::uuid, ${reason}, ${input.ip}) as data
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
  if (data === null) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Evento não encontrado.",
      messageKey: "events.errors.notFound",
    });
  }
  return data;
}

/**
 * Does the data a customer presents give the event's seal? Uses only the
 * situation the platform sees plus the presented data.
 */
export async function checkPresentedData(
  tx: ContextTransaction,
  actor: PlatformEventsActor,
  eventId: string,
  presented: unknown,
): Promise<SealCheck | null> {
  const detail = await platformEventDetail(tx, actor, eventId);
  if (!detail) return null;
  return verifyPresentedData(
    {
      id: detail.id,
      type: detail.type,
      partner_id: detail.partnerId,
      organization_id: detail.organizationId,
      workspace_id: detail.workspaceId,
      subject_type: detail.subjectType,
      subject_id: detail.subjectId,
      created_by: detail.createdBy,
      occurred_at: detail.occurredAt,
      prev_hash: detail.prevHash,
      content_hash: detail.contentHash,
      key_version: detail.keyVersion,
    },
    presented,
    sealKeys(),
  );
}

export type TeamMember = Readonly<{
  userId: string;
  role: string;
  status: string;
  fullName: string | null;
  keychain: boolean;
  keychainGrantedAt: Date | null;
}>;

function requireCapabilityManager(actor: PlatformEventsActor): void {
  if (
    actor.platformRole === null ||
    !hasPlatformRolePermission(
      actor.platformRole,
      Permissions.PLATFORM_CAPABILITIES_MANAGE,
    )
  ) {
    throw denied();
  }
}

/** The platform team and the capability of each (owner only). */
export async function platformTeam(
  tx: ContextTransaction,
  actor: PlatformEventsActor,
): Promise<TeamMember[]> {
  requireCapabilityManager(actor);
  const rows = await tx.$queryRaw<
    {
      user_id: string;
      role: string;
      status: string;
      full_name: string | null;
      keychain: boolean;
      keychain_granted_at: Date | null;
    }[]
  >`select * from private.platform_team()`;
  return rows.map((row) => ({
    userId: row.user_id,
    role: row.role,
    status: row.status,
    fullName: row.full_name,
    keychain: row.keychain,
    keychainGrantedAt: row.keychain_granted_at,
  }));
}

/**
 * The owner grants or removes `keychain` (themselves included), audited
 * as `platform.capability.grant` / `.revoke`.
 */
export async function setKeychain(
  tx: ContextTransaction,
  actor: PlatformEventsActor,
  targetUserId: string,
  enabled: boolean,
): Promise<boolean> {
  requireCapabilityManager(actor);
  if (!z.uuid().safeParse(targetUserId).success) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Pessoa não encontrada na equipe da plataforma.",
      messageKey: "events.errors.memberNotFound",
    });
  }
  let changed: number;
  if (enabled) {
    const [active] = await tx.$queryRaw<{ active: boolean }[]>`
      select private.platform_member_active(${targetUserId}::uuid) as active
    `;
    if (!active?.active) {
      throw new AppError({
        code: "not_found",
        safeMessage: "Pessoa não encontrada na equipe da plataforma.",
        messageKey: "events.errors.memberNotFound",
      });
    }
    changed = await tx.$executeRaw`
      insert into public.platform_admin_capabilities (user_id, capability, granted_by)
      values (${targetUserId}::uuid, 'keychain', ${actor.userId}::uuid)
      on conflict (user_id, capability) do nothing
    `;
  } else {
    changed = await tx.$executeRaw`
      delete from public.platform_admin_capabilities
      where user_id = ${targetUserId}::uuid and capability = 'keychain'
    `;
  }
  if (changed > 0) {
    await recordAudit(
      tx,
      {
        userId: actor.userId,
        workspaceId: "",
        organizationId: "",
        principalType: "user",
      },
      {
        action: enabled
          ? "platform.capability.grant"
          : "platform.capability.revoke",
        resourceType: "platform_admin_capability",
        resourceId: targetUserId,
        result: "success",
        origin: "admin",
        metadata: { targetUserId, capability: "keychain" },
      },
    );
  }
  return changed > 0;
}
