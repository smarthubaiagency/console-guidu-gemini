import { billingJobs, billingSchedules } from "@/core/billing/automation";
import { workspaceExportJob } from "@/core/privacy/export";
import { privacyJobs, privacySchedules } from "@/core/privacy/maintenance";
import { helloWorldJobs } from "@/modules/hello-world/jobs";

import type { JobDefinition, JobSchedule } from "./definition";

/**
 * Jobs known to this build, by explicit import (like the module registry).
 * Core platform jobs (billing, F3c) come first.
 */
// Each definition validates its own payload type; the registry erases it.
const DEFINITIONS = [
  ...billingJobs,
  ...privacyJobs,
  workspaceExportJob,
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

/** Recurring platform jobs started by the worker's scheduler. */
export function listJobSchedules(): readonly JobSchedule[] {
  return [...billingSchedules, ...privacySchedules];
}
