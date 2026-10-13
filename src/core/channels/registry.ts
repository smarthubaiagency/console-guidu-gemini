import { createAiAgentsChannelConsumer } from "@/modules/ai-agents/server/channel-consumer";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { listChannelInboxes } from "./connections";
import type { ChannelConsumer } from "./consumer";
import { createChannelDispatchJob } from "./dispatch";

/**
 * Consumers of the channels known to this build, by explicit import (like
 * the job and module registries). Today only the GUIDS (A5b).
 */
export const CHANNEL_CONSUMERS: readonly ChannelConsumer[] = [
  createAiAgentsChannelConsumer(),
];

export const channelDispatchJob = createChannelDispatchJob({
  consumers: CHANNEL_CONSUMERS,
});

export type InboxOwner = Readonly<{
  module: string;
  name: string | null;
  /** False when the consumer does not answer now (a paused GUIDS). */
  active: boolean;
}>;

/**
 * Who answers each inbox of the workspace, by `connectionId:inboxId`, for
 * the health of the connections (A5c). Inboxes without a route are absent.
 */
export async function describeInboxOwners(
  tx: ContextTransaction,
  ctx: RequestContext,
  consumers: readonly ChannelConsumer[] = CHANNEL_CONSUMERS,
): Promise<Record<string, InboxOwner>> {
  const inboxes = await listChannelInboxes(tx, ctx);
  const owners: Record<string, InboxOwner> = {};
  for (const consumer of consumers) {
    const routed = inboxes.filter(
      (inbox) => inbox.route?.consumerModule === consumer.module,
    );
    if (routed.length === 0) continue;
    const info = consumer.describe
      ? await consumer.describe(
          tx,
          ctx,
          routed.map((inbox) => inbox.route!.consumerRef),
        )
      : new Map();
    for (const inbox of routed) {
      const ref = info.get(inbox.route!.consumerRef);
      owners[`${inbox.connectionId}:${inbox.inboxId}`] = {
        module: consumer.module,
        name: ref?.name ?? null,
        active: ref?.active ?? true,
      };
    }
  }
  return owners;
}
