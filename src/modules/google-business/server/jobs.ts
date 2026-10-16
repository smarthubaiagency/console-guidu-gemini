import "server-only";

import { z } from "zod";

import { contextPartnerId, emitEvent } from "@/core/events/emit";
import { defineDetachedJob } from "@/core/jobs/definition";

import { runBackgroundAnalyses } from "./background";
import { BACKGROUND_TIMEOUT_MS } from "./runner";

/**
 * Job of the background analyses (GB1a): detached, because an analysis may
 * wait on the network (AI, maps) and must not hold a transaction. Runs with
 * the context of whoever finished the onboarding (a member in `padrao`, the
 * managing partner in `gerenciado`); when it ends, the Event Hub (H1) gets
 * `google_business.analyses_done` (route `subject_person`): a notice in
 * that person's bell with the link to the automation page.
 */
export const BackgroundAnalysesPayload = z.strictObject({
  locationId: z.uuid(),
  /** Absolute link to the automation page, on the host of the onboarding. */
  linkUrl: z.url().max(2000).optional(),
});

export const backgroundAnalysesJob = defineDetachedJob({
  kind: "google-business.background-analyses",
  description: "Análises em segundo plano de uma ficha do Google",
  payload: BackgroundAnalysesPayload,
  maxAttempts: 2,
  expireInSeconds: 15 * 60,
  async run(session, ctx, payload) {
    const result = await runBackgroundAnalyses(
      session.transaction,
      ctx,
      payload.locationId,
      BACKGROUND_TIMEOUT_MS,
    );
    if (result.ran > 0) {
      await session.transaction(async (tx) =>
        emitEvent(tx, {
          type: "google_business.analyses_done",
          actor: {
            userId: ctx.userId,
            principalType: "user",
            origin: "worker",
          },
          partnerId: await contextPartnerId(tx),
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          subject: { type: "gb_location", id: payload.locationId },
          recipientUserId: ctx.userId,
          data: {
            location: result.name.slice(0, 200),
            failed: String(result.failed),
            linkUrl: payload.linkUrl ?? null,
          },
          idempotencyKey: `google-business.analyses:${payload.locationId}:${session.jobRunId}`,
        }),
      );
    }
    return { ran: result.ran, failed: result.failed };
  },
});
