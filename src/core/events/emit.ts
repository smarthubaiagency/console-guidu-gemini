import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { type AuditOrigin, recordAudit } from "@/core/audit/record";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  DESTINATION_STAGE,
  type EventDefinition,
  eventDefinition,
  type EventLevel,
  type EventRoute,
  type EventType,
  MAX_EVENT_DEPTH,
  missingDestinations,
  placementOf,
} from "./catalog";
import { chainKeyOf, computeSeal, currentSealKey, normalizeData } from "./seal";

/**
 * The single entry point of the Event Hub (H1, ADR 0022 §1): a service
 * tells what happened, in the transaction of the change. `emitEvent`
 * checks the type in the catalog, seals the event in its chain, records it
 * and, in the same transaction, queues `events.dispatch` (destination
 * `notify`) and records the audit (destination `audit`). The same key
 * twice is a no-op that answers the event already recorded.
 *
 * Runs as app_runtime (a request or a workspace job, for the workspace of
 * its context) or as app_worker (platform jobs). Without the seal key it
 * throws: an event is never recorded unsealed.
 *
 * H4: an event may name its cause (`causedBy`), the event that led to it
 * (a hand-off, a step of a proposal). Its depth is the cause's plus one,
 * computed by the database; past `MAX_EVENT_DEPTH` the emission is
 * refused (`EventChainLimitError`). The dispatch is queued for the types
 * with `notify` or `subscribers`.
 */

export const EVENTS_DISPATCH_JOB_KIND = "events.dispatch";

/** The largest `data`, a little under the database limit (16 KB). */
export const MAX_EVENT_DATA_BYTES = 15_000;

export type EventActor = Readonly<{
  /** Who caused it; null for the platform's own jobs. */
  userId: string | null;
  principalType: "user" | "service" | "api_key";
  origin: AuditOrigin;
}>;

/** The platform's jobs (app_worker): no person, origin worker. */
export const WORKER_ACTOR: EventActor = {
  userId: null,
  principalType: "service",
  origin: "worker",
};

export type EmitEventInput = Readonly<{
  type: EventType;
  actor: EventActor;
  partnerId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  subject?: Readonly<{ type: string; id: string }> | null;
  /** The person of the `subject_person` route. */
  recipientUserId?: string | null;
  data: Readonly<Record<string, unknown>>;
  /** Stable key: the same key never records a second event. */
  idempotencyKey: string;
  occurredAt?: Date;
  /** `pending` for a type that waits for a decision (`approval`, H2). */
  status?: "open" | "pending";
  /** The event that caused this one (H4), in the same workspace. */
  causedBy?: string | null;
}>;

export type EmittedEvent = Readonly<{ id: string; created: boolean }>;

function invalid(message: string): AppError {
  return new AppError({ code: "invalid_input", safeMessage: message });
}

/** The cause is already at the last level of the chain (H4). */
export class EventChainLimitError extends AppError {
  constructor(type: string) {
    super({
      code: "conflict",
      safeMessage: `O evento ${type} passaria do limite de ${MAX_EVENT_DEPTH} níveis da corrente de causas.`,
    });
    this.name = "EventChainLimitError";
  }
}

/** The definition of an emittable type, or an explicit refusal. */
export function requireEmittable(type: string): EventDefinition {
  const definition = eventDefinition(type);
  if (!definition) throw invalid(`Evento fora do catálogo: ${type}.`);
  if (definition.inline) {
    throw invalid(`O evento ${type} é enviado pela própria requisição.`);
  }
  const missing = missingDestinations(definition);
  if (missing.length > 0) {
    throw invalid(
      `O evento ${type} usa destinos ainda não construídos: ${missing
        .map((d) => `${d} (${DESTINATION_STAGE[d] ?? "?"})`)
        .join(", ")}.`,
    );
  }
  return definition;
}

type Scope = Readonly<{
  partnerId: string | null;
  organizationId: string | null;
  workspaceId: string | null;
}>;

type Placement = Readonly<{
  scope: Scope;
  level: EventLevel;
  route: EventRoute;
}>;

function placementFor(
  definition: EventDefinition,
  input: EmitEventInput,
): Placement {
  const scope = {
    partnerId: input.partnerId ?? null,
    organizationId: input.organizationId ?? null,
    workspaceId: input.workspaceId ?? null,
  };
  // The type's level, or another one it may also live at (AJ1).
  const placement = placementOf(definition, scope);
  if (!placement) {
    throw invalid(
      `O evento ${definition.type} é do nível ${definition.level} e veio com outro escopo.`,
    );
  }
  return { scope, ...placement };
}

const uuidOrNull = (value: string | null) =>
  value ? Prisma.sql`${value}::uuid` : Prisma.sql`null`;

export async function emitEvent(
  tx: ContextTransaction,
  input: EmitEventInput,
): Promise<EmittedEvent> {
  const definition = requireEmittable(input.type);
  const key = currentSealKey();
  const { scope, level, route } = placementFor(definition, input);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw invalid("Chave do evento inválida.");
  }
  if (route === "subject_person" && !input.recipientUserId) {
    throw invalid(`O evento ${definition.type} precisa da pessoa a avisar.`);
  }
  const status = input.status ?? "open";
  if (status === "pending" && !definition.approval) {
    throw invalid(`O evento ${definition.type} não espera decisão.`);
  }
  const data = normalizeData(input.data) as Record<string, unknown>;
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json, "utf8") > MAX_EVENT_DATA_BYTES) {
    throw invalid(`Os dados do evento ${definition.type} são grandes demais.`);
  }

  const causedBy = input.causedBy ?? null;
  if (causedBy) {
    const [cause] = await tx.$queryRaw<{ depth: number | null }[]>`
      select private.event_depth(${causedBy}::uuid) as depth
    `;
    if (cause?.depth === null || cause?.depth === undefined) {
      throw invalid(`A causa do evento ${definition.type} não existe.`);
    }
    if (Number(cause.depth) >= MAX_EVENT_DEPTH) {
      throw new EventChainLimitError(definition.type);
    }
  }

  const chainKey = chainKeyOf(scope);
  const [head] = await tx.$queryRaw<
    { existing_id: string | null; prev_hash: string | null; next_seq: bigint }[]
  >`select existing_id, prev_hash, next_seq from private.event_prepare(${chainKey}, ${idempotencyKey})`;
  if (head?.existing_id) return { id: head.existing_id, created: false };

  const id = randomUUID();
  // Milliseconds, as JavaScript and the seal keep them.
  const occurredAt = new Date(input.occurredAt?.getTime() ?? Date.now());
  const prevHash = head?.prev_hash ?? null;
  const seq = Number(head?.next_seq ?? 1);
  const subject = input.subject ?? null;
  const createdBy = input.actor.userId;
  const contentHash = computeSeal(
    {
      id,
      type: definition.type,
      ...scope,
      subjectType: subject?.type ?? null,
      subjectId: subject?.id ?? null,
      createdBy,
      occurredAt,
      data,
      prevHash,
      causedBy,
    },
    key.secret,
  );

  // No RETURNING: app_runtime reads only the events addressed to the
  // customer of its workspace.
  await tx.$executeRaw`
    insert into public.events (
      id, type, module, level, partner_id, organization_id, workspace_id,
      subject_type, subject_id, severity, audiences, route, recipient_user_id,
      data, idempotency_key, created_by, occurred_at, chain_key, seq,
      content_hash, prev_hash, key_version, status, caused_by_event_id
    ) values (
      ${id}::uuid, ${definition.type}, ${definition.module}, ${level},
      ${uuidOrNull(scope.partnerId)}, ${uuidOrNull(scope.organizationId)},
      ${uuidOrNull(scope.workspaceId)}, ${subject?.type ?? null}, ${subject?.id ?? null},
      ${definition.severity}, ${[...definition.audiences]}::text[], ${route},
      ${uuidOrNull(input.recipientUserId ?? null)}, ${json}::jsonb, ${idempotencyKey},
      ${uuidOrNull(createdBy)}, ${occurredAt}, ${chainKey}, ${seq},
      ${contentHash}, ${prevHash}, ${key.version}, ${status}, ${uuidOrNull(causedBy)}
    )
  `;

  if (
    definition.destinations.includes("notify") ||
    definition.destinations.includes("subscribers")
  ) {
    await tx.$executeRaw`
      insert into public.job_runs (kind, scope, requested_by, payload, idempotency_key, max_attempts)
      values (${EVENTS_DISPATCH_JOB_KIND}, 'platform', ${uuidOrNull(createdBy)},
              ${JSON.stringify({ eventId: id })}::jsonb, ${`event:${id}`}, 3)
    `;
  }

  if (definition.destinations.includes("audit")) {
    const service = input.actor.principalType === "service";
    await recordAudit(
      tx,
      {
        userId: createdBy ?? "",
        // The worker records as a service of the platform, never in a
        // workspace's name; the target goes in the metadata.
        workspaceId: service ? "" : (scope.workspaceId ?? ""),
        organizationId: service ? "" : (scope.organizationId ?? ""),
        principalType: input.actor.principalType,
      },
      {
        action: definition.type,
        resourceType: subject?.type ?? "event",
        resourceId: subject?.id ?? id,
        result: "success",
        origin: input.actor.origin,
        metadata: {
          eventId: id,
          eventType: definition.type,
          target: scope.workspaceId ?? scope.organizationId ?? scope.partnerId,
        },
      },
    );
  }

  return { id, created: true };
}

/** The partner of the context's company, for app_runtime callers. */
export async function contextPartnerId(
  tx: ContextTransaction,
): Promise<string | null> {
  const [row] = await tx.$queryRaw<{ partner_id: string | null }[]>`
    select private.ai_turn_partner_id() as partner_id
  `;
  return row?.partner_id ?? null;
}
