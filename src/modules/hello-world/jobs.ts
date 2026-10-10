import { z } from "zod";

import { defineJob } from "@/core/jobs/definition";

import { createHelloWorldRecord } from "./server/services/records";

/**
 * Reference job of the module (F3a): creates a record in the background
 * through the same service as the web, which re-checks the module state,
 * the permission and the demonstration limit when the job runs.
 */
export const createRecordJob = defineJob({
  kind: "hello-world.create-record",
  description: "Cria um registro de exemplo em segundo plano.",
  payload: z.object({ title: z.string().trim().min(1).max(120) }),
  maxAttempts: 3,
  retryDelaySeconds: 2,
  async run(tx, ctx, payload) {
    const record = await createHelloWorldRecord(tx, ctx, payload);
    return { recordId: record.id };
  },
});

export const helloWorldJobs = [createRecordJob] as const;
