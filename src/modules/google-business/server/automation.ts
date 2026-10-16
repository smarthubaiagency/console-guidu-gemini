import "server-only";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { effectiveSettings } from "@/core/settings/read";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import type {
  AnalysisFinding,
  AnalysisStatus,
  LocationAnalysis,
} from "../analyses/contract";
import { locationAnalyses } from "../analyses/registry";
import {
  AREA_FINDING_AREAS,
  AUTOMATION_AREAS,
  type AreaOverride,
  type Autonomy,
  AUTONOMY_LEVELS,
  type AutomationArea,
  completeSkillSettings,
  type EffectiveArea,
  effectiveArea,
  INSIGHT_AREAS,
  minAutonomy,
  nextArea,
  type SkillSettings,
} from "../areas";
import { managerKind, requireManager, requireReader } from "./access";
import { gbNotFound } from "./errors";
import {
  readServiceMode,
  type ServiceMode,
} from "@/core/organizations/service-mode";

/**
 * The automation page of a ficha (GB1a, especificação §7 and §8): the
 * areas with their switch and autonomy (cascade of ADR 0018 plus the ficha
 * level), the tips the analyses found for each area, the diagnosis count
 * and the "suggest only" lock until the first review. Reading is for the
 * workspace's members and the managing partner; saving for whoever
 * operates (`requireManager`).
 */

export type RunView = Readonly<{
  key: string;
  area: string;
  phase: LocationAnalysis["phase"];
  labelKey: string;
  usesAi: boolean;
  status: AnalysisStatus;
  findings: readonly AnalysisFinding[];
  metrics: Readonly<Record<string, number | null>>;
}>;

export type AutomationView = Readonly<{
  location: Readonly<{
    id: string;
    name: string;
    unitName: string | null;
    address: string | null;
    provider: string;
    reviewed: boolean;
    createdAt: string;
  }>;
  mode: ServiceMode;
  canManage: boolean;
  ceiling: Autonomy;
  areas: readonly EffectiveArea[];
  configured: number;
  runs: readonly RunView[];
  diagnosis: Readonly<{ ok: number; total: number }>;
  points: number;
}>;

const KNOWN = new Map(locationAnalyses.map((a) => [a.key, a]));

function asFindings(value: unknown): AnalysisFinding[] {
  return Array.isArray(value) ? (value as AnalysisFinding[]) : [];
}

function asMetrics(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v === null || typeof v === "number",
    ),
  ) as Record<string, number | null>;
}

/** "X de Y itens em ordem": the checklist items of every analysis done. */
export function diagnosisOf(runs: readonly RunView[]): {
  ok: number;
  total: number;
} {
  let ok = 0;
  let total = 0;
  for (const run of runs) {
    if (run.status !== "done") continue;
    const itemsOk = run.metrics.itemsOk;
    const itemsTotal = run.metrics.itemsTotal;
    if (typeof itemsOk === "number" && typeof itemsTotal === "number") {
      ok += itemsOk;
      total += itemsTotal;
    }
  }
  return { ok, total };
}

/** Findings of the contract areas a page area shows as tips. */
export function tipsOf(
  area: AutomationArea,
  runs: readonly RunView[],
): AnalysisFinding[] {
  const areas = new Set<string>(AREA_FINDING_AREAS[area]);
  return runs
    .filter((r) => r.status === "done")
    .flatMap((r) => r.findings)
    .filter((f) => areas.has(f.area));
}

/** Runs of the areas shown only as analyses (services, maps). */
export function insightRuns(runs: readonly RunView[]): RunView[] {
  const areas = new Set<string>(INSIGHT_AREAS);
  return runs.filter((r) => areas.has(r.area));
}

async function cascade(
  tx: ContextTransaction,
): Promise<{ skills: SkillSettings; ceiling: Autonomy }> {
  const settings = await effectiveSettings(tx);
  return {
    skills: completeSkillSettings(settings.values["google_business.skills"]),
    ceiling: settings.values["google_business.autonomy_ceiling"],
  };
}

export async function loadAutomation(
  tx: ContextTransaction,
  ctx: RequestContext,
  locationId: string,
): Promise<AutomationView> {
  await requireReader(tx, ctx);
  if (!z.uuid().safeParse(locationId).success) throw gbNotFound();
  const location = await tx.gbLocation.findFirst({
    where: { id: locationId, workspaceId: ctx.workspaceId },
  });
  if (!location) throw gbNotFound();
  const [unit, runRows, overrides, mode, { skills, ceiling }, manager] =
    await Promise.all([
      location.unitId
        ? tx.workspaceLocation.findFirst({
            where: { id: location.unitId },
            select: { name: true, address: true },
          })
        : null,
      tx.gbAnalysisRun.findMany({
        where: { gbLocationId: locationId },
        orderBy: { createdAt: "asc" },
      }),
      tx.gbAreaSetting.findMany({ where: { gbLocationId: locationId } }),
      readServiceMode(tx, ctx.organizationId),
      cascade(tx),
      managerKind(tx, ctx),
    ]);

  const runs: RunView[] = runRows.map((row) => {
    const analysis = KNOWN.get(row.analysisKey);
    return {
      key: row.analysisKey,
      area: row.area,
      phase: row.phase as LocationAnalysis["phase"],
      labelKey: analysis?.labelKey ?? `googleBusiness.analyses.unknown`,
      usesAi: analysis?.usesAi ?? false,
      status: row.status as AnalysisStatus,
      findings: asFindings(row.findings),
      metrics: asMetrics(row.metrics),
    };
  });
  const byArea = new Map(
    overrides.map((o) => [
      o.area,
      {
        enabled: o.enabled,
        autonomy: o.autonomy as Autonomy,
        approvedAt: o.approvedAt,
      } satisfies AreaOverride,
    ]),
  );
  const reviewed = Boolean(location.reviewedAt);
  const areas = AUTOMATION_AREAS.map((area) =>
    effectiveArea(area, skills, ceiling, byArea.get(area) ?? null, reviewed),
  );
  const address = (unit?.address ?? {}) as {
    street_address?: string;
    address_locality?: string;
  };
  return {
    location: {
      id: location.id,
      name: location.name,
      unitName: unit?.name ?? null,
      address:
        [address.street_address, address.address_locality]
          .filter(Boolean)
          .join(", ") || null,
      provider: location.provider,
      reviewed,
      createdAt: location.createdAt.toISOString(),
    },
    mode,
    canManage: manager !== null,
    ceiling,
    areas,
    configured: areas.filter((a) => a.approved).length,
    runs,
    diagnosis: diagnosisOf(runs),
    points: runs
      .filter((r) => r.status === "done")
      .reduce((sum, r) => sum + r.findings.length, 0),
  };
}

export const SaveAreaInput = z.strictObject({
  area: z.enum(AUTOMATION_AREAS),
  enabled: z.boolean(),
  autonomy: z.enum(AUTONOMY_LEVELS),
  approve: z.boolean(),
});

export type SaveAreaResult = Readonly<{
  next: AutomationArea | null;
  configured: number;
  reviewed: boolean;
}>;

export async function saveArea(
  tx: ContextTransaction,
  ctx: RequestContext,
  locationId: string,
  input: z.input<typeof SaveAreaInput>,
): Promise<SaveAreaResult> {
  const actor = await requireManager(tx, ctx);
  const parsed = SaveAreaInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Dados inválidos.",
      messageKey: "googleBusiness.errors.invalidInput",
    });
  }
  const { area, enabled, autonomy, approve } = parsed.data;
  const location = await tx.gbLocation.findFirst({
    where: { id: locationId, workspaceId: ctx.workspaceId },
    select: { id: true, unitId: true, reviewedAt: true },
  });
  if (!location?.unitId) throw gbNotFound();
  const { ceiling } = await cascade(tx);
  if (minAutonomy(autonomy, ceiling) !== autonomy) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Essa autonomia passa do limite definido para você.",
      messageKey: "googleBusiness.errors.aboveCeiling",
    });
  }
  const current = await tx.gbAreaSetting.findUnique({
    where: { gbLocationId_area: { gbLocationId: locationId, area } },
    select: { approvedAt: true, approvedBy: true },
  });
  const approval = approve
    ? { approvedAt: new Date(), approvedBy: ctx.userId }
    : {
        approvedAt: current?.approvedAt ?? null,
        approvedBy: current?.approvedBy ?? null,
      };
  await tx.gbAreaSetting.upsert({
    where: { gbLocationId_area: { gbLocationId: locationId, area } },
    create: {
      gbLocationId: locationId,
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      area,
      enabled,
      autonomy,
      updatedBy: ctx.userId,
      ...(approve ? approval : {}),
    },
    update: { enabled, autonomy, updatedBy: ctx.userId, ...approval },
  });
  const origin = actor === "partner" ? ("admin" as const) : ("app" as const);
  await recordAudit(tx, ctx, {
    action: approve
      ? "google_business.area.approve"
      : "google_business.area.save",
    resourceType: "gb_location",
    resourceId: locationId,
    result: "success",
    origin,
    metadata: { target: area, status: enabled ? "on" : "off", mode: autonomy },
  });

  const approvedRows = await tx.gbAreaSetting.findMany({
    where: { gbLocationId: locationId, approvedAt: { not: null } },
    select: { area: true },
  });
  const approved = new Set(approvedRows.map((r) => r.area as AutomationArea));
  let reviewed = Boolean(location.reviewedAt);
  // First review: every area approved once lifts the "suggest only" lock.
  if (!reviewed && AUTOMATION_AREAS.every((a) => approved.has(a))) {
    await tx.gbLocation.update({
      where: { id: locationId },
      data: {
        reviewedAt: new Date(),
        reviewedBy: ctx.userId,
        updatedBy: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: "google_business.location.review",
      resourceType: "gb_location",
      resourceId: locationId,
      result: "success",
      origin,
    });
    reviewed = true;
  }
  return {
    next: approve ? nextArea(area, approved) : area,
    configured: approved.size,
    reviewed,
  };
}

export type LocationSummary = Readonly<{
  id: string;
  name: string;
  unitName: string | null;
  onboardingStatus: string;
  reviewed: boolean;
  configured: number;
}>;

/** Fichas of the workspace, for the module's home and the partner list. */
export async function listLocations(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<LocationSummary[]> {
  await requireReader(tx, ctx);
  const rows = await tx.gbLocation.findMany({
    where: { workspaceId: ctx.workspaceId, unitId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  if (rows.length === 0) return [];
  const [units, approvals] = await Promise.all([
    tx.workspaceLocation.findMany({
      where: { id: { in: rows.map((r) => r.unitId!) } },
      select: { id: true, name: true },
    }),
    tx.gbAreaSetting.groupBy({
      by: ["gbLocationId"],
      where: {
        gbLocationId: { in: rows.map((r) => r.id) },
        approvedAt: { not: null },
      },
      _count: { _all: true },
    }),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const configured = new Map(
    approvals.map((a) => [a.gbLocationId, a._count._all]),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    unitName: unitName.get(row.unitId!) ?? null,
    onboardingStatus: row.onboardingStatus,
    reviewed: Boolean(row.reviewedAt),
    configured: configured.get(row.id) ?? 0,
  }));
}
