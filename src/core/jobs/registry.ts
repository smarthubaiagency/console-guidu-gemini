import { helloWorldJobs } from "@/modules/hello-world/jobs";

import type { JobDefinition } from "./definition";

/**
 * Jobs known to this build, by explicit import (like the module registry).
 * Core jobs join here in later stages (billing in F3c).
 */
// Each definition validates its own payload type; the registry erases it.
const DEFINITIONS = [
  ...helloWorldJobs,
] as unknown as readonly JobDefinition<unknown>[];

const BY_KIND: ReadonlyMap<string, JobDefinition<unknown>> = new Map(
  DEFINITIONS.map((definition) => [definition.kind, definition]),
);

if (BY_KIND.size !== DEFINITIONS.length) {
  throw new Error("Duplicated job kind in the registry");
}

export function listJobDefinitions(): readonly JobDefinition<unknown>[] {
  return DEFINITIONS;
}

export function getJobDefinition(kind: string): JobDefinition<unknown> | null {
  return BY_KIND.get(kind) ?? null;
}
