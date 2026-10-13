import { createAiAgentsChannelConsumer } from "@/modules/ai-agents/server/channel-consumer";

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
