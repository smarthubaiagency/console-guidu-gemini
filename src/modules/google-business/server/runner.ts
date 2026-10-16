import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";

import {
  ANALYSIS_AREAS,
  type AnalysisResult,
  type LocationAnalysis,
  type LocationSnapshot,
  type ReviewSummary,
} from "../analyses/contract";
import { locationAnalyses } from "../analyses/registry";

/**
 * Runner of the location analyses (GB1a, contract with the GB1b). Each
 * analysis of the registry has one row in `gb_analysis_runs`, created as
 * `pending` when the ficha is read. A run marks the row `running` in a short
 * transaction, calls the analysis outside any transaction (an analysis may
 * wait on the network) with a time limit, checks the shape of the result
 * and writes it in another short transaction. A failure is recorded as
 * `failed` with an English reason for the logs; the page shows a generic
 * message. Blocking analyses run in the onboarding window; background ones
 * in a job of the worker.
 */

export type Db = <T>(
  operation: (tx: ContextTransaction) => Promise<T>,
) => Promise<T>;

export const BLOCKING_TIMEOUT_MS = 60_000;
export const BACKGROUND_TIMEOUT_MS = 5 * 60_000;
const MAX_FINDINGS = 200;

const FindingSchema = z.object({
  key: z.string().min(1).max(80),
  area: z.enum(ANALYSIS_AREAS),
  severity: z.enum(["critical", "high", "medium", "low"]),
  titleKey: z.string().min(1).max(200),
  detailKey: z.string().min(1).max(200),
  values: z
    .record(z.string(), z.union([z.string().max(500), z.number()]))
    .optional(),
  current: z.string().max(2000).nullable().optional(),
  suggested: z.string().max(2000).nullable().optional(),
  source: z.enum(["deterministic", "ai", "maps"]),
});

const ResultSchema = z.object({
  status: z.enum(["done", "failed", "skipped"]),
  findings: z.array(FindingSchema).max(MAX_FINDINGS),
  metrics: z.record(z.string().max(60), z.number().nullable()).optional(),
  error: z.string().optional(),
});

export function analysisByKey(key: string): LocationAnalysis | null {
  return locationAnalyses.find((a) => a.key === key) ?? null;
}

export function analysesOfPhase(
  phase: LocationAnalysis["phase"],
): readonly LocationAnalysis[] {
  return locationAnalyses.filter((a) => a.phase === phase);
}

/** One `pending` row per analysis of the registry (idempotent). */
export async function seedAnalysisRuns(
  tx: ContextTransaction,
  ctx: RequestContext,
  locationId: string,
): Promise<void> {
  if (locationAnalyses.length === 0) return;
  await tx.gbAnalysisRun.createMany({
    data: locationAnalyses.map((analysis) => ({
      gbLocationId: locationId,
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      analysisKey: analysis.key,
      area: analysis.area,
      phase: analysis.phase,
      createdBy: ctx.userId,
    })),
    skipDuplicates: true,
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type AnalysisInput = Readonly<{
  locationId: string;
  unitId: string;
  snapshot: LocationSnapshot;
  reviews: readonly ReviewSummary[];
}>;

/** Runs one analysis and records its result; returns the result kept. */
export async function runAnalysis(
  db: Db,
  ctx: RequestContext,
  analysis: LocationAnalysis,
  input: AnalysisInput,
  timeoutMs: number,
): Promise<AnalysisResult> {
  await db((tx) =>
    tx.gbAnalysisRun.updateMany({
      where: { gbLocationId: input.locationId, analysisKey: analysis.key },
      data: {
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
        error: null,
        updatedBy: ctx.userId,
      },
    }),
  );

  let result: AnalysisResult;
  try {
    const raw = await withTimeout(
      analysis.run({
        request: ctx,
        locationId: input.locationId,
        unitId: input.unitId,
        snapshot: input.snapshot,
        reviews: input.reviews,
      }),
      timeoutMs,
    );
    const parsed = ResultSchema.safeParse(raw);
    result = parsed.success
      ? (parsed.data as AnalysisResult)
      : { status: "failed", findings: [], error: "invalid result shape" };
  } catch (error) {
    result = {
      status: "failed",
      findings: [],
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
  if (result.status === "failed") {
    appLog.warn("google_business.analysis_failed", {
      analysis: analysis.key,
      reason: (result.error ?? "unknown").slice(0, 200),
    });
  }

  await db((tx) =>
    tx.gbAnalysisRun.updateMany({
      where: { gbLocationId: input.locationId, analysisKey: analysis.key },
      data: {
        status: result.status,
        findings: result.findings as unknown as Prisma.InputJsonValue,
        metrics: (result.metrics ?? {}) as Prisma.InputJsonValue,
        error: result.error ? result.error.slice(0, 500) : null,
        finishedAt: new Date(),
        updatedBy: ctx.userId,
      },
    }),
  );
  return result;
}
