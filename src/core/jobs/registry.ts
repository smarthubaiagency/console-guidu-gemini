import { keyWatchJob, keyWatchSchedule } from "@/core/ai/key-watch";
import { leadNoticeJob } from "@/core/ai/notices/lead";
import { guidTurnJob } from "@/core/ai/turn/guid";
import { billingJobs, billingSchedules } from "@/core/billing/automation";
import { channelDispatchJob } from "@/core/channels/registry";
import { eventsDispatchJob } from "@/core/events/dispatch";
import { verifyChainsJob, verifyChainsSchedule } from "@/core/events/verify";
import { translateTextsJob } from "@/core/i18n/machine/texts-job";
import { translateDocumentJob } from "@/core/legal/machine-job";
import { matrixCleanupSchedule, matrixJobs } from "@/core/matrix/jobs";
import { workspaceExportJob } from "@/core/privacy/export";
import {
  workspaceLifecycleJob,
  workspacePurgeJob,
} from "@/core/privacy/lifecycle-jobs";
import { privacyJobs, privacySchedules } from "@/core/privacy/maintenance";
import { proposalExecuteJob } from "@/core/proposals/service";
import { backgroundAnalysesJob } from "@/modules/google-business/server/jobs";
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
  // Workspace deletion (WS1): hooks, notices and the purge itself.
  workspaceLifecycleJob,
  workspacePurgeJob,
  // Event Hub (H1): dispatch of each event and the daily seal check.
  eventsDispatchJob,
  verifyChainsJob,
  translateTextsJob,
  translateDocumentJob,
  workspaceExportJob,
  proposalExecuteJob,
  guidTurnJob,
  keyWatchJob,
  leadNoticeJob,
  channelDispatchJob,
  // Matrix core of the Inbox (IN3).
  ...matrixJobs,
  backgroundAnalysesJob,
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
  return [
    ...billingSchedules,
    ...privacySchedules,
    keyWatchSchedule,
    verifyChainsSchedule,
    matrixCleanupSchedule,
  ];
}
