import "server-only";

import { z } from "zod";

import { defineDetachedJob } from "@/core/jobs/definition";

import { runBackgroundAnalyses } from "./background";
import { BACKGROUND_TIMEOUT_MS } from "./runner";

/**
 * Job of the background analyses (GB1a): detached, because an analysis may
 * wait on the network (AI, maps) and must not hold a transaction. Runs with
 * the context of whoever finished the onboarding (a member in `padrao`, the
 * managing partner in `gerenciado`); when it ends, a notice goes to that
 * person's bell with the link to the automation page.
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
      await session.transaction(
        (tx) =>
          tx.$queryRaw`
          select private.post_google_business_notice(
            ${JSON.stringify({ location: result.name.slice(0, 200), failed: String(result.failed) })}::jsonb,
            ${payload.linkUrl ?? null},
            ${`google-business.analyses:${payload.locationId}:${session.jobRunId}`}
          )
        `,
      );
    }
    return { ran: result.ran, failed: result.failed };
  },
});
