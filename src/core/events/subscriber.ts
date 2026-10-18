import "server-only";

import { WorkspaceClosedError } from "@/core/jobs/errors";
import { isWorkspaceActive } from "@/core/workspaces/active";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import type { EventType } from "./catalog";

/**
 * Contract of a subscriber of the Event Hub (H4, destination
 * `subscribers`): the hand-off of work from an event to another agent's
 * job. Each subscriber declares its key, its module and the event types it
 * receives; the registry (`subscribers.ts`) imports them explicitly, so
 * adding one is a code change with its tests, like the proposal
 * operations (F4d). Nothing here is specific to a module: the Google
 * Business agent (GB2) and the digital profile lead (DP4) use the same
 * path.
 *
 * The handler runs in the job `events.subscriber` (platform, app_worker),
 * once per event and subscriber, behind a savepoint: a failure is
 * recorded on its hand-off and tried again (3 attempts), and never
 * touches the other subscribers of the event. To act for a person (the
 * approver of a proposal, the operator of a module) it enters that
 * person's context with `withRequesterContext`, where RLS and the module
 * services apply as in the web.
 */

export type SubscriberEvent = Readonly<{
  id: string;
  type: string;
  partnerId: string | null;
  organizationId: string | null;
  workspaceId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  createdBy: string | null;
  depth: number;
  data: Readonly<Record<string, unknown>>;
}>;

export type SubscriberOutcome = Readonly<{
  status: "done" | "skipped";
  /** Short code shown in the trace (e.g. the proposal's error). */
  reason?: string | null;
}>;

export type EventSubscriber = Readonly<{
  /** `<module>.<name>`, e.g. `proposals.execute`. */
  key: string;
  /** Module whose state gates it in the workspace; `core` is always on. */
  moduleKey: string;
  eventTypes: readonly EventType[];
  description: string;
  handle(
    tx: ContextTransaction,
    event: SubscriberEvent,
  ): Promise<SubscriberOutcome | void>;
}>;

export const CORE_MODULE = "core";

const SUBSCRIBER_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$/;

export function defineSubscriber(subscriber: EventSubscriber): EventSubscriber {
  if (!SUBSCRIBER_KEY.test(subscriber.key) || subscriber.key.length > 96) {
    throw new Error(`Invalid subscriber key: ${subscriber.key}`);
  }
  if (subscriber.eventTypes.length === 0) {
    throw new Error(`Subscriber without event types: ${subscriber.key}`);
  }
  return Object.freeze(subscriber);
}

/**
 * Runs `operation` as the person of `ctx` (app_runtime, with the context
 * of the request), inside the worker's transaction, as the worker does for
 * a workspace job. The workspace must be active (WS1). The role and the
 * context are transaction-local: they go back when the operation ends and
 * are undone with the subscriber's savepoint on a failure.
 */
export async function withRequesterContext<T>(
  tx: ContextTransaction,
  ctx: RequestContext,
  operation: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  if (!(await isWorkspaceActive(tx, ctx.workspaceId))) {
    throw new WorkspaceClosedError();
  }
  await tx.$executeRaw`
    select
      set_config('app.user_id', ${ctx.userId}, true),
      set_config('app.workspace_id', ${ctx.workspaceId}, true),
      set_config('app.organization_id', ${ctx.organizationId}, true),
      set_config('app.partner_id', ${ctx.partnerId ?? ""}, true),
      set_config('app.principal_type', 'user', true),
      set_config('app.grant_id', '', true)
  `;
  await tx.$executeRawUnsafe("set local role app_runtime");
  const result = await operation(tx);
  await tx.$executeRawUnsafe("reset role");
  await tx.$executeRaw`
    select
      set_config('app.user_id', '', true),
      set_config('app.workspace_id', '', true),
      set_config('app.organization_id', '', true),
      set_config('app.partner_id', '', true),
      set_config('app.principal_type', '', true)
  `;
  return result;
}
