import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { type AuditOrigin, recordAudit } from "@/core/audit/record";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  DESTINATION_STAGE,
  type EventDefinition,
  eventDefinition,
  type EventType,
  missingDestinations,
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
}>;

export type EmittedEvent = Readonly<{ id: string; created: boolean }>;

function invalid(message: string): AppError {
  return new AppError({ code: "invalid_input", safeMessage: message });
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

function scopeOf(definition: EventDefinition, input: EmitEventInput): Scope {
  const scope = {
    partnerId: input.partnerId ?? null,
    organizationId: input.organizationId ?? null,
    workspaceId: input.workspaceId ?? null,
  };
  const ok =
    definition.level === "workspace"
      ? Boolean(scope.workspaceId && scope.organizationId && scope.partnerId)
      : definition.level === "partner"
        ? Boolean(scope.partnerId) && !scope.workspaceId
        : !scope.partnerId && !scope.organizationId && !scope.workspaceId;
  if (!ok) {
    throw invalid(
      `O evento ${definition.type} é do nível ${definition.level} e veio com outro escopo.`,
    );
  }
  return scope;
}

const uuidOrNull = (value: string | null) =>
  value ? Prisma.sql`${value}::uuid` : Prisma.sql`null`;

export async function emitEvent(
  tx: ContextTransaction,
  input: EmitEventInput,
): Promise<EmittedEvent> {
  const definition = requireEmittable(input.type);
  const key = currentSealKey();
  const scope = scopeOf(definition, input);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw invalid("Chave do evento inválida.");
  }
  if (definition.route === "subject_person" && !input.recipientUserId) {
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
      content_hash, prev_hash, key_version, status
    ) values (
      ${id}::uuid, ${definition.type}, ${definition.module}, ${definition.level},
      ${uuidOrNull(scope.partnerId)}, ${uuidOrNull(scope.organizationId)},
      ${uuidOrNull(scope.workspaceId)}, ${subject?.type ?? null}, ${subject?.id ?? null},
      ${definition.severity}, ${[...definition.audiences]}::text[], ${definition.route},
      ${uuidOrNull(input.recipientUserId ?? null)}, ${json}::jsonb, ${idempotencyKey},
      ${uuidOrNull(createdBy)}, ${occurredAt}, ${chainKey}, ${seq},
      ${contentHash}, ${prevHash}, ${key.version}, ${status}
    )
  `;

  if (definition.destinations.includes("notify")) {
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
