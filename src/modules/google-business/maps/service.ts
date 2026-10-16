import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { assertWithinQuota, resolveQuota } from "@/core/entitlements/quotas";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { requireManager, requireReader } from "../server/access";

import type { CompetitorStat } from "./competitors";
import type { LatLng } from "./geo";
import { KEYWORD_MAX, KEYWORD_MIN, normalizeKeyword } from "./keywords";
import type { RankMatrix } from "./metrics";
import {
  DEFAULT_RADIUS_KM,
  effectiveGridSize,
  effectiveKeywordLimit,
  effectiveScanLimit,
  MapsQuotas,
  monthStart,
} from "./quotas";
import type { ReviewStats } from "./reviews";
import type { ScoreDimension } from "./score";
import type {
  MapsCompetitorView,
  MapsHealthView,
  MapsKeywordView,
} from "./view";

/**
 * Data of the Saúde no Maps of a unit (GB1b): keywords, reference
 * competitors and measurements, in the tables of the GB1b migration. Every
 * function runs inside the caller's context transaction (RLS applies);
 * reads need a member or the managing partner, writes the operator of the
 * ficha (owner/admin in `padrao` mode or the managing partner, ADR 0020),
 * the same rule the database repeats. Writes are audited.
 */

export type MapsKeyword = Readonly<{
  id: string;
  keyword: string;
  source: "agent" | "user";
  status: "active" | "paused";
}>;

export type MapsReferenceCompetitor = Readonly<{
  id: string;
  placeId: string;
  source: "agent" | "user";
  status: "active" | "removed";
}>;

const KEYWORD_LABEL = "Palavras-chave monitoradas no mapa por unidade";
const SCANS_LABEL = "Medições do mapa por unidade por mês";

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Unidade não encontrada.",
    messageKey: "gbIntelligence.errors.unitNotFound",
  });
}

function invalid(key: string, message: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `gbIntelligence.errors.${key}`,
  });
}

const Uuid = z.uuid();

/** The active unit of the workspace, with its own coordinates. */
export async function loadUnit(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
): Promise<{ id: string; name: string; center: LatLng | null }> {
  if (!Uuid.safeParse(unitId).success) throw notFound();
  const row = await tx.workspaceLocation.findFirst({
    where: { id: unitId, workspaceId: ctx.workspaceId, status: "active" },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  if (!row) throw notFound();
  return {
    id: row.id,
    name: row.name,
    center:
      row.latitude !== null && row.longitude !== null
        ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
        : null,
  };
}

/** One write at a time per unit (keywords, competitors, measurements). */
async function lockUnit(tx: ContextTransaction, unitId: string): Promise<void> {
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`gb_maps:${unitId}`}))`;
}

// ----------------------------------------------------------------------------
// Keywords
// ----------------------------------------------------------------------------

export async function listMapsKeywords(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
): Promise<MapsKeyword[]> {
  await requireReader(tx, ctx);
  await loadUnit(tx, ctx, unitId);
  const rows = await tx.gbMapsKeyword.findMany({
    where: { workspaceId: ctx.workspaceId, locationId: unitId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, keyword: true, source: true, status: true },
  });
  return rows as MapsKeyword[];
}

async function keywordLimit(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<number> {
  const quota = await resolveQuota(tx, ctx.organizationId, MapsQuotas.KEYWORDS);
  return effectiveKeywordLimit(quota.limit);
}

async function activeKeywordCount(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
): Promise<number> {
  return tx.gbMapsKeyword.count({
    where: {
      workspaceId: ctx.workspaceId,
      locationId: unitId,
      status: "active",
    },
  });
}

const KeywordInput = z.strictObject({
  keyword: z.string().trim().min(KEYWORD_MIN).max(KEYWORD_MAX),
});

/** Adds a keyword chosen by whoever operates, within the plan quota. */
export async function addMapsKeyword(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
  input: unknown,
): Promise<MapsKeyword> {
  await requireManager(tx, ctx);
  const parsed = KeywordInput.safeParse(input);
  if (!parsed.success) {
    throw invalid("keywordInvalid", "Use de 2 a 80 caracteres.");
  }
  await loadUnit(tx, ctx, unitId);
  await lockUnit(tx, unitId);
  const keyword = normalizeKeyword(parsed.data.keyword);
  const existing = await tx.gbMapsKeyword.findMany({
    where: { workspaceId: ctx.workspaceId, locationId: unitId },
    select: { keyword: true },
  });
  if (existing.some((row) => normalizeKeyword(row.keyword) === keyword)) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Esta palavra-chave já é monitorada.",
      messageKey: "gbIntelligence.errors.keywordExists",
    });
  }
  const limit = await keywordLimit(tx, ctx);
  assertWithinQuota(
    { key: MapsQuotas.KEYWORDS, limit, source: "plan" },
    await activeKeywordCount(tx, ctx, unitId),
    KEYWORD_LABEL,
  );
  const row = await tx.gbMapsKeyword.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      locationId: unitId,
      keyword,
      source: "user",
      createdBy: ctx.userId,
    },
    select: { id: true, keyword: true, source: true, status: true },
  });
  await recordAudit(tx, ctx, {
    action: "google_business.maps.keyword.create",
    resourceType: "gb_maps_keyword",
    resourceId: row.id,
    result: "success",
    metadata: { kind: "user", status: "active" },
  });
  return row as MapsKeyword;
}

/** Pauses or resumes a keyword; resuming counts against the quota. */
export async function setMapsKeywordStatus(
  tx: ContextTransaction,
  ctx: RequestContext,
  keywordId: string,
  status: "active" | "paused",
): Promise<MapsKeyword> {
  await requireManager(tx, ctx);
  if (
    !Uuid.safeParse(keywordId).success ||
    !["active", "paused"].includes(status)
  ) {
    throw invalid("keywordInvalid", "Palavra-chave inválida.");
  }
  const found = await tx.gbMapsKeyword.findFirst({
    where: { id: keywordId, workspaceId: ctx.workspaceId },
  });
  if (!found) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Palavra-chave não encontrada.",
      messageKey: "apiErrors.notFound",
    });
  }
  await lockUnit(tx, found.locationId);
  if (status === "active" && found.status !== "active") {
    assertWithinQuota(
      {
        key: MapsQuotas.KEYWORDS,
        limit: await keywordLimit(tx, ctx),
        source: "plan",
      },
      await activeKeywordCount(tx, ctx, found.locationId),
      KEYWORD_LABEL,
    );
  }
  const row = await tx.gbMapsKeyword.update({
    where: { id: found.id },
    data: { status, updatedBy: ctx.userId },
    select: { id: true, keyword: true, source: true, status: true },
  });
  await recordAudit(tx, ctx, {
    action: "google_business.maps.keyword.update",
    resourceType: "gb_maps_keyword",
    resourceId: row.id,
    result: "success",
    metadata: { status },
  });
  return row as MapsKeyword;
}

/**
 * The active keywords of the unit; when it has none yet (first onboarding),
 * the agent's suggestions are saved first, as many as the plan allows.
 */
export async function ensureAgentKeywords(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
  suggestions: readonly string[],
): Promise<{ keywords: MapsKeyword[]; created: number; trimmed: number }> {
  await requireManager(tx, ctx);
  await loadUnit(tx, ctx, unitId);
  await lockUnit(tx, unitId);
  const existing = await tx.gbMapsKeyword.findMany({
    where: { workspaceId: ctx.workspaceId, locationId: unitId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, keyword: true, source: true, status: true },
  });
  const limit = await keywordLimit(tx, ctx);
  if (existing.length > 0) {
    const active = (existing as MapsKeyword[]).filter(
      (k) => k.status === "active",
    );
    return {
      keywords: active.slice(0, limit),
      created: 0,
      trimmed: Math.max(0, active.length - limit),
    };
  }
  const unique = [...new Set(suggestions.map(normalizeKeyword))].filter(
    (k) => k.length >= KEYWORD_MIN && k.length <= KEYWORD_MAX,
  );
  const picked = unique.slice(0, limit);
  const created: MapsKeyword[] = [];
  for (const keyword of picked) {
    const row = await tx.gbMapsKeyword.create({
      data: {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        locationId: unitId,
        keyword,
        source: "agent",
        createdBy: ctx.userId,
      },
      select: { id: true, keyword: true, source: true, status: true },
    });
    created.push(row as MapsKeyword);
  }
  if (created.length > 0) {
    await recordAudit(tx, ctx, {
      action: "google_business.maps.keyword.create",
      resourceType: "workspace_location",
      resourceId: unitId,
      result: "success",
      metadata: { kind: "agent", count: created.length },
    });
  }
  return {
    keywords: created,
    created: created.length,
    trimmed: unique.length - picked.length,
  };
}

// ----------------------------------------------------------------------------
// Reference competitors
// ----------------------------------------------------------------------------

const PlaceId = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .regex(/^[A-Za-z0-9_:-]+$/);

export async function listReferenceCompetitors(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
): Promise<MapsReferenceCompetitor[]> {
  await requireReader(tx, ctx);
  await loadUnit(tx, ctx, unitId);
  const rows = await tx.gbMapsCompetitor.findMany({
    where: { workspaceId: ctx.workspaceId, locationId: unitId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, placeId: true, source: true, status: true },
  });
  return rows as MapsReferenceCompetitor[];
}

/** Marks (or unmarks) a competitor of the radius as reference. */
export async function setReferenceCompetitor(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
  placeId: string,
  active: boolean,
): Promise<MapsReferenceCompetitor> {
  await requireManager(tx, ctx);
  const parsed = PlaceId.safeParse(placeId);
  if (!parsed.success) throw invalid("placeInvalid", "Concorrente inválido.");
  await loadUnit(tx, ctx, unitId);
  await lockUnit(tx, unitId);
  const status = active ? "active" : "removed";
  const existing = await tx.gbMapsCompetitor.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      locationId: unitId,
      placeId: parsed.data,
    },
  });
  const row = existing
    ? await tx.gbMapsCompetitor.update({
        where: { id: existing.id },
        data: { status, updatedBy: ctx.userId },
        select: { id: true, placeId: true, source: true, status: true },
      })
    : await tx.gbMapsCompetitor.create({
        data: {
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          locationId: unitId,
          placeId: parsed.data,
          source: "user",
          status,
          createdBy: ctx.userId,
        },
        select: { id: true, placeId: true, source: true, status: true },
      });
  await recordAudit(tx, ctx, {
    action: "google_business.maps.competitor.update",
    resourceType: "gb_maps_competitor",
    resourceId: row.id,
    result: "success",
    metadata: { status },
  });
  return row as MapsReferenceCompetitor;
}

/**
 * The agent's pick of reference competitors (the strongest of the radius)
 * when the unit has none yet; whoever operates adjusts it afterwards.
 */
export async function ensureReferenceCompetitors(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
  placeIds: readonly string[],
): Promise<number> {
  await requireManager(tx, ctx);
  await lockUnit(tx, unitId);
  const count = await tx.gbMapsCompetitor.count({
    where: { workspaceId: ctx.workspaceId, locationId: unitId },
  });
  if (count > 0) return 0;
  const valid = [...new Set(placeIds)].filter(
    (id) => PlaceId.safeParse(id).success,
  );
  for (const placeId of valid) {
    await tx.gbMapsCompetitor.create({
      data: {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        locationId: unitId,
        placeId,
        source: "agent",
        createdBy: ctx.userId,
      },
    });
  }
  if (valid.length > 0) {
    await recordAudit(tx, ctx, {
      action: "google_business.maps.competitor.update",
      resourceType: "workspace_location",
      resourceId: unitId,
      result: "success",
      metadata: { kind: "agent", count: valid.length, status: "active" },
    });
  }
  return valid.length;
}

// ----------------------------------------------------------------------------
// Measurements
// ----------------------------------------------------------------------------

export type MapsScanPlan = Readonly<{
  /** No starting point yet: this one is it, outside the monthly quota. */
  isBaseline: boolean;
  gridSize: number;
  radiusKm: number;
  monthlyUsed: number;
  monthlyLimit: number;
  /** False when the monthly quota is used up (never for the baseline). */
  allowed: boolean;
}>;

/** What the next measurement of the unit may be, under the plan quotas. */
export async function planMapsScan(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
  now: Date,
): Promise<MapsScanPlan> {
  await requireManager(tx, ctx);
  await loadUnit(tx, ctx, unitId);
  const where = { workspaceId: ctx.workspaceId, locationId: unitId };
  const [baseline, monthlyUsed, gridQuota, scanQuota] = await Promise.all([
    tx.gbMapsScan.count({ where: { ...where, isBaseline: true } }),
    tx.gbMapsScan.count({
      where: {
        ...where,
        isBaseline: false,
        createdAt: { gte: monthStart(now) },
      },
    }),
    resolveQuota(tx, ctx.organizationId, MapsQuotas.GRID_SIZE),
    resolveQuota(tx, ctx.organizationId, MapsQuotas.SCANS_PER_MONTH),
  ]);
  const isBaseline = baseline === 0;
  const monthlyLimit = effectiveScanLimit(scanQuota.limit);
  return {
    isBaseline,
    gridSize: effectiveGridSize(gridQuota.limit),
    radiusKm: DEFAULT_RADIUS_KM,
    monthlyUsed,
    monthlyLimit,
    allowed: isBaseline || monthlyUsed < monthlyLimit,
  };
}

/** Competitors of the previous measurement of each keyword of the unit. */
export async function previousCompetitors(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
): Promise<Map<string, CompetitorStat[]>> {
  await requireReader(tx, ctx);
  const last = await tx.gbMapsScan.findFirst({
    where: { workspaceId: ctx.workspaceId, locationId: unitId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { results: { select: { keywordId: true, competitors: true } } },
  });
  return new Map(
    (last?.results ?? []).map((result) => [
      result.keywordId,
      (Array.isArray(result.competitors)
        ? result.competitors
        : []) as unknown as CompetitorStat[],
    ]),
  );
}

/** A recent measurement of the unit (retry of the same onboarding). */
export async function recentScanId(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
  since: Date,
): Promise<string | null> {
  const row = await tx.gbMapsScan.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      locationId: unitId,
      createdAt: { gte: since },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return row?.id ?? null;
}

export type MapsScanKeywordInput = Readonly<{
  keywordId: string;
  keyword: string;
  ranks: RankMatrix;
  solv: number;
  averageRank: number | null;
  foundPoints: number;
  totalPoints: number;
  competitors: readonly CompetitorStat[];
  neighborhoods: readonly string[];
}>;

export type MapsScanInput = Readonly<{
  unitId: string;
  isBaseline: boolean;
  gridSize: number;
  radiusKm: number;
  score: number | null;
  breakdown: readonly ScoreDimension[];
  reviews: ReviewStats;
  provider: "dataforseo" | "fake";
  apiCalls: number;
  costEstimateMicros: number;
  keywords: readonly MapsScanKeywordInput[];
}>;

/**
 * Writes a measurement and its keyword results. The monthly quota is
 * checked again under the unit lock; the starting point never counts and
 * exists once per unit (a second one becomes a regular measurement).
 */
export async function recordMapsScan(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: MapsScanInput,
  now: Date,
): Promise<{ scanId: string; isBaseline: boolean }> {
  await requireManager(tx, ctx);
  await loadUnit(tx, ctx, input.unitId);
  await lockUnit(tx, input.unitId);
  if (input.keywords.length === 0) {
    throw invalid("noKeywords", "Nenhuma palavra-chave para medir.");
  }
  const plan = await planMapsScan(tx, ctx, input.unitId, now);
  const isBaseline = plan.isBaseline && input.isBaseline;
  if (!isBaseline) {
    assertWithinQuota(
      {
        key: MapsQuotas.SCANS_PER_MONTH,
        limit: plan.monthlyLimit,
        source: "plan",
      },
      plan.monthlyUsed,
      SCANS_LABEL,
    );
  }
  const scan = await tx.gbMapsScan.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      locationId: input.unitId,
      isBaseline,
      gridSize: input.gridSize,
      radiusM: Math.round(input.radiusKm * 1000),
      keywordCount: input.keywords.length,
      score: input.score,
      scoreBreakdown: input.breakdown as unknown as Prisma.InputJsonValue,
      reviewStats: input.reviews as unknown as Prisma.InputJsonValue,
      provider: input.provider,
      apiCalls: input.apiCalls,
      costEstimateMicros: BigInt(input.costEstimateMicros),
      createdBy: ctx.userId,
      // The clock of the run, so the monthly quota and the reuse window
      // read the same time the analysis used.
      createdAt: now,
    },
    select: { id: true },
  });
  await tx.gbMapsScanResult.createMany({
    data: input.keywords.map((result) => ({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      scanId: scan.id,
      keywordId: result.keywordId,
      keyword: result.keyword,
      ranks: result.ranks as unknown as Prisma.InputJsonValue,
      solv: new Prisma.Decimal(result.solv),
      averageRank:
        result.averageRank === null
          ? null
          : new Prisma.Decimal(result.averageRank),
      foundPoints: result.foundPoints,
      totalPoints: result.totalPoints,
      competitors: result.competitors as unknown as Prisma.InputJsonValue,
      neighborhoods: result.neighborhoods as unknown as Prisma.InputJsonValue,
    })),
  });
  await recordAudit(tx, ctx, {
    action: "google_business.maps.scan.create",
    resourceType: "gb_maps_scan",
    resourceId: scan.id,
    result: "success",
    origin: "worker",
    metadata: {
      provider: input.provider,
      kind: isBaseline ? "baseline" : "scan",
      count: input.keywords.length,
    },
  });
  return { scanId: scan.id, isBaseline };
}

/** Score and mean SoLV of the starting point of the unit, if any. */
export async function baselineSummary(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
): Promise<{ score: number | null; solv: number } | null> {
  await requireReader(tx, ctx);
  const baseline = await tx.gbMapsScan.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      locationId: unitId,
      isBaseline: true,
    },
    include: { results: true },
  });
  return baseline ? { score: baseline.score, solv: meanSolv(baseline) } : null;
}

// ----------------------------------------------------------------------------
// View for the component
// ----------------------------------------------------------------------------

type ScanRow = Prisma.GbMapsScanGetPayload<{ include: { results: true } }>;

function meanSolv(scan: ScanRow): number {
  if (scan.results.length === 0) return 0;
  const sum = scan.results.reduce((total, r) => total + Number(r.solv), 0);
  return Math.round((sum / scan.results.length) * 100) / 100;
}

/**
 * The latest measurement of the unit with its starting point, ready for
 * `MapsHealthPanel`; null before the first measurement.
 */
export async function loadMapsHealthView(
  tx: ContextTransaction,
  ctx: RequestContext,
  unitId: string,
): Promise<MapsHealthView | null> {
  await requireReader(tx, ctx);
  await loadUnit(tx, ctx, unitId);
  const where = { workspaceId: ctx.workspaceId, locationId: unitId };
  const [latest, baseline, references] = await Promise.all([
    tx.gbMapsScan.findFirst({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        results: { orderBy: [{ createdAt: "asc" }, { keyword: "asc" }] },
      },
    }),
    tx.gbMapsScan.findFirst({
      where: { ...where, isBaseline: true },
      include: { results: true },
    }),
    tx.gbMapsCompetitor.findMany({
      where: { ...where, status: "active" },
      select: { placeId: true },
    }),
  ]);
  if (!latest) return null;
  const referenceIds = new Set(references.map((r) => r.placeId));
  const keywords: MapsKeywordView[] = latest.results.map((result) => ({
    keyword: result.keyword,
    gridSize: latest.gridSize,
    ranks: result.ranks as unknown as RankMatrix,
    solv: Number(result.solv),
    averageRank:
      result.averageRank === null ? null : Number(result.averageRank),
    foundPoints: result.foundPoints,
    totalPoints: result.totalPoints,
    competitors: (
      (result.competitors as unknown as CompetitorStat[] | null) ?? []
    ).map((competitor): MapsCompetitorView => ({
      ...competitor,
      isReference:
        competitor.placeId !== null && referenceIds.has(competitor.placeId),
    })),
    neighborhoods: (result.neighborhoods as unknown as string[] | null) ?? [],
  }));
  return {
    scanId: latest.id,
    measuredAt: latest.createdAt.toISOString(),
    isBaseline: latest.isBaseline,
    gridSize: latest.gridSize,
    radiusKm: latest.radiusM / 1000,
    score: latest.score,
    breakdown: latest.scoreBreakdown as unknown as ScoreDimension[],
    reviews: (latest.reviewStats as unknown as ReviewStats | null) ?? null,
    keywords,
    baseline:
      baseline && baseline.id !== latest.id
        ? {
            measuredAt: baseline.createdAt.toISOString(),
            score: baseline.score,
            solv: meanSolv(baseline),
          }
        : null,
    provider: latest.provider,
    apiCalls: latest.apiCalls,
    costEstimateMicros: Number(latest.costEstimateMicros),
  };
}
