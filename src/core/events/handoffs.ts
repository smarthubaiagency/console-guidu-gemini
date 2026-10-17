import "server-only";

import { z } from "zod";

import { definePlatformJob } from "@/core/jobs/definition";
import { WorkspaceClosedError } from "@/core/jobs/errors";
import { isWorkspaceActive } from "@/core/workspaces/active";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { getRegisteredModule } from "@/modules/registry";
import { toSafeError } from "@/shared/errors";

import { MAX_EVENT_DEPTH } from "./catalog";
import {
  CORE_MODULE,
  type EventSubscriber,
  type SubscriberEvent,
} from "./subscriber";
import { getSubscriber, subscribersOf } from "./subscribers";

/**
 * Destination `subscribers` of the Event Hub (H4): the hand-off of work.
 *
 * - `queueHandoffs` (in `events.dispatch`, app_worker): one hand-off per
 *   event and subscriber of its type, and one job `events.subscriber`
 *   with the key `event:<id>:sub:<key>`; running the dispatch again adds
 *   nothing. An event at the last level of the chain of causes
 *   (`MAX_EVENT_DEPTH`) hands nothing over: its hand-offs are `skipped /
 *   chain_limit`.
 * - `runHandoff` (the job): locks the hand-off, which never runs twice
 *   once `done` or `skipped`; a subscriber whose module is off in the
 *   workspace is `skipped / module_disabled`, a closed workspace
 *   `skipped / workspace_closed`; the handler runs behind a savepoint, so
 *   a failure is recorded as `failed` with its reason and tried again by
 *   a follow-up run, up to 3 attempts, without touching the other
 *   subscribers.
 */

export const EVENTS_SUBSCRIBER_JOB_KIND = "events.subscriber";
export const HANDOFF_MAX_ATTEMPTS = 3;
const RETRY_DELAY_SECONDS = 30;

export type HandoffDeps = Readonly<{
  /** Lookups of the registry; tests give their own subscribers. */
  subscribersOf?: (type: string) => readonly EventSubscriber[];
  getSubscriber?: (key: string) => EventSubscriber | null;
}>;

type HandoffEvent = Readonly<{
  id: string;
  type: string;
  depth: number;
  partner_id: string | null;
  organization_id: string | null;
  workspace_id: string | null;
}>;

async function queueRun(
  tx: ContextTransaction,
  eventId: string,
  subscriber: string,
  key: string,
  delaySeconds: number,
): Promise<string | null> {
  const [run] = await tx.$queryRaw<{ id: string }[]>`
    insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts, run_after)
    values (${EVENTS_SUBSCRIBER_JOB_KIND}, 'platform',
            ${JSON.stringify({ eventId, subscriber })}::jsonb, ${key}, 3,
            now() + make_interval(secs => ${delaySeconds}))
    on conflict (kind, idempotency_key) do nothing
    returning id
  `;
  return run?.id ?? null;
}

/** The hand-offs of an event (dispatch); the number of new ones. */
export async function queueHandoffs(
  tx: ContextTransaction,
  event: HandoffEvent,
  deps: HandoffDeps = {},
): Promise<number> {
  const subscribers = (deps.subscribersOf ?? subscribersOf)(event.type);
  let created = 0;
  for (const subscriber of subscribers) {
    const limited = Number(event.depth) >= MAX_EVENT_DEPTH;
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      insert into public.event_handoffs
        (event_id, subscriber, module, partner_id, organization_id, workspace_id,
         status, reason, finished_at)
      values (${event.id}::uuid, ${subscriber.key}, ${subscriber.moduleKey},
              ${event.partner_id}::uuid, ${event.organization_id}::uuid,
              ${event.workspace_id}::uuid,
              ${limited ? "skipped" : "queued"}, ${limited ? "chain_limit" : null},
              ${limited ? new Date() : null})
      on conflict (event_id, subscriber) do nothing
      returning id
    `;
    if (!row) continue;
    created += 1;
    if (limited) continue;
    const runId = await queueRun(
      tx,
      event.id,
      subscriber.key,
      `event:${event.id}:sub:${subscriber.key}`.slice(0, 200),
      0,
    );
    if (runId) {
      await tx.$executeRaw`
        update public.event_handoffs set job_run_id = ${runId}::uuid
        where id = ${row.id}::uuid
      `;
    }
  }
  return created;
}

type HandoffRow = Readonly<{
  id: string;
  status: string;
  attempts: number;
}>;

type EventRow = Readonly<{
  id: string;
  type: string;
  partner_id: string | null;
  organization_id: string | null;
  workspace_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  created_by: string | null;
  depth: number;
  data: Record<string, unknown>;
}>;

export type HandoffResult = Readonly<{
  status: "done" | "skipped" | "failed" | "missing";
  reason: string | null;
}>;

/** Whether the subscriber's module is on in the event's workspace. */
async function moduleOn(
  tx: ContextTransaction,
  eventId: string,
  moduleKey: string,
): Promise<boolean> {
  if (moduleKey === CORE_MODULE) return true;
  const mod = getRegisteredModule(moduleKey);
  if (!mod || !mod.technicalGate()) return false;
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    select private.event_module_enabled(${eventId}::uuid, ${moduleKey}) as ok
  `;
  return row?.ok === true;
}

export async function runHandoff(
  tx: ContextTransaction,
  eventId: string,
  key: string,
  deps: HandoffDeps = {},
): Promise<HandoffResult> {
  const [handoff] = await tx.$queryRaw<HandoffRow[]>`
    select id, status, attempts from public.event_handoffs
    where event_id = ${eventId}::uuid and subscriber = ${key}
    for update
  `;
  if (!handoff) return { status: "missing", reason: null };
  if (handoff.status === "done" || handoff.status === "skipped") {
    return { status: handoff.status, reason: null };
  }
  if (handoff.attempts >= HANDOFF_MAX_ATTEMPTS) {
    return { status: "failed", reason: "attempts" };
  }

  const finish = async (
    status: "done" | "skipped" | "failed",
    reason: string | null,
    attempts: number,
  ): Promise<HandoffResult> => {
    await tx.$executeRaw`
      update public.event_handoffs
      set status = ${status}, reason = ${reason?.slice(0, 80) ?? null},
          attempts = ${attempts},
          finished_at = ${status === "failed" ? null : new Date()}
      where id = ${handoff.id}::uuid
    `;
    return { status, reason };
  };

  const subscriber = (deps.getSubscriber ?? getSubscriber)(key);
  if (!subscriber)
    return finish("skipped", "unknown_subscriber", handoff.attempts);
  const [event] = await tx.$queryRaw<EventRow[]>`
    select id, type, partner_id, organization_id, workspace_id, subject_type,
           subject_id, created_by, depth, data
    from public.events where id = ${eventId}::uuid
  `;
  if (!event) return finish("skipped", "event_missing", handoff.attempts);
  if (
    event.workspace_id &&
    !(await isWorkspaceActive(tx, event.workspace_id))
  ) {
    return finish("skipped", "workspace_closed", handoff.attempts);
  }
  if (!(await moduleOn(tx, event.id, subscriber.moduleKey))) {
    return finish("skipped", "module_disabled", handoff.attempts);
  }

  const attempts = handoff.attempts + 1;
  const input: SubscriberEvent = {
    id: event.id,
    type: event.type,
    partnerId: event.partner_id,
    organizationId: event.organization_id,
    workspaceId: event.workspace_id,
    subjectType: event.subject_type,
    subjectId: event.subject_id,
    createdBy: event.created_by,
    depth: Number(event.depth),
    data: event.data ?? {},
  };
  await tx.$executeRawUnsafe("savepoint event_handoff");
  try {
    const outcome = await subscriber.handle(tx, input);
    await tx.$executeRawUnsafe("release savepoint event_handoff");
    return finish(outcome?.status ?? "done", outcome?.reason ?? null, attempts);
  } catch (error) {
    await tx.$executeRawUnsafe("rollback to savepoint event_handoff");
    if (error instanceof WorkspaceClosedError) {
      return finish("skipped", "workspace_closed", attempts);
    }
    const reason = toSafeError(error).code;
    const result = await finish("failed", reason, attempts);
    if (attempts < HANDOFF_MAX_ATTEMPTS) {
      // A follow-up run tries again; the trace shows the failure meanwhile.
      const runId = await queueRun(
        tx,
        eventId,
        key,
        `event:${eventId}:sub:${key}:retry:${attempts}`.slice(0, 200),
        RETRY_DELAY_SECONDS * attempts,
      );
      if (runId) {
        await tx.$executeRaw`
          update public.event_handoffs set job_run_id = ${runId}::uuid
          where id = ${handoff.id}::uuid
        `;
      }
    }
    return result;
  }
}

export const EventsSubscriberPayload = z.strictObject({
  eventId: z.uuid(),
  subscriber: z.string().min(3).max(96),
});

export function createEventsSubscriberJob(deps: HandoffDeps = {}) {
  return definePlatformJob<z.infer<typeof EventsSubscriberPayload>>({
    kind: EVENTS_SUBSCRIBER_JOB_KIND,
    description:
      "Passa um evento da Central de Eventos a um assinante (passagem de trabalho), uma vez por evento e assinante.",
    payload: EventsSubscriberPayload,
    maxAttempts: 3,
    retryDelaySeconds: 30,
    async run(tx, payload) {
      const result = await runHandoff(
        tx,
        payload.eventId,
        payload.subscriber,
        deps,
      );
      return { status: result.status, reason: result.reason };
    },
  });
}

export const eventsSubscriberJob = createEventsSubscriberJob();
