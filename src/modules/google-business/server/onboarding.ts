import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { enqueueJob } from "@/core/jobs/service";
import { LocationInput } from "@/core/locations/service";
import { effectiveSettings } from "@/core/settings/read";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import type { LocationSnapshot } from "../analyses/contract";
import type { GoogleBusinessProvider, LocationOption } from "../provider/port";
import { requireManager } from "./access";
import { gbConflict, gbNotFound } from "./errors";
import { initialSnapshot, locationForRun } from "./inputs";
import { backgroundAnalysesJob } from "./jobs";
import {
  analysesOfPhase,
  analysisByKey,
  BLOCKING_TIMEOUT_MS,
  type Db,
  runAnalysis,
  seedAnalysisRuns,
} from "./runner";

/**
 * The "Adicionar local" onboarding (GB1a, especificação §7):
 *
 * 1. `prepareLocation`: connects the chosen ficha, reads it and its public
 *    reviews, writes the ficha (`gb_locations`), its initial version (base
 *    of the defense) and one pending row per analysis; returns the units
 *    with the same address, so the screen proposes linking instead of
 *    duplicating.
 * 2. `attachUnit`: links the ficha to an existing unit or creates the unit
 *    from the ficha's data.
 * 3. `runBlockingAnalysis`: one blocking analysis at a time, so the window
 *    marks each step as it really ends.
 * 4. `finishOnboarding`: queues the background analyses and returns the
 *    number of points to validate.
 *
 * Nothing is changed on the ficha: everything only reads and suggests.
 */

/** Public reviews kept with the initial version. */
export const REVIEWS_READ_LIMIT = 50;

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type UnitMatch = Readonly<{
  id: string;
  name: string;
  address: string;
}>;

export type PreparedLocation = Readonly<{
  locationId: string;
  name: string;
  /** Already linked (an onboarding repeated): no question to ask. */
  unitId: string | null;
  matches: readonly UnitMatch[];
}>;

/** Lowercase, no accents, words split by single spaces. */
export function normalizeAddress(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type UnitAddress = Readonly<{
  street_address?: string;
  address_locality?: string;
}>;

/** One line of the ficha's address, as the provider reported it. */
export function snapshotAddressLine(snapshot: LocationSnapshot): string {
  const address = snapshot.address;
  if (!address) return "";
  return [
    address.lines.join(", "),
    address.locality,
    address.administrativeArea,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * A unit has the same address when its street line opens the ficha's
 * address and the cities, when both are known, are the same.
 */
export function sameAddress(
  snapshot: LocationSnapshot,
  unit: UnitAddress,
): boolean {
  const street = normalizeAddress(unit.street_address ?? "");
  if (!street || !snapshot.address) return false;
  const ficha = normalizeAddress(snapshot.address.lines.join(" "));
  if (ficha !== street && !ficha.startsWith(`${street} `)) return false;
  const left = normalizeAddress(snapshot.address.locality ?? "");
  const right = normalizeAddress(unit.address_locality ?? "");
  return !left || !right || left === right;
}

/** The unit (UCP Location) built from the ficha's data. */
export function unitFromSnapshot(
  snapshot: LocationSnapshot,
  fallbackTimezone: string,
): z.input<typeof LocationInput> {
  const address = snapshot.address;
  const phone =
    snapshot.phone && /^\+[1-9]\d{6,14}$/.test(snapshot.phone)
      ? snapshot.phone
      : undefined;
  const country =
    address?.countryCode && /^[A-Z]{2}$/.test(address.countryCode)
      ? address.countryCode
      : undefined;
  return {
    name: snapshot.name.slice(0, 120) || "Unidade",
    address: {
      ...(address?.lines.length
        ? { street_address: address.lines.join(", ").slice(0, 200) }
        : {}),
      ...(address?.locality
        ? { address_locality: address.locality.slice(0, 120) }
        : {}),
      ...(address?.administrativeArea
        ? { address_region: address.administrativeArea.slice(0, 80) }
        : {}),
      ...(address?.postalCode
        ? { postal_code: address.postalCode.slice(0, 20) }
        : {}),
      ...(country ? { address_country: country } : {}),
      ...(phone ? { phone_number: phone } : {}),
    },
    geo:
      snapshot.latitude !== null && snapshot.longitude !== null
        ? { latitude: snapshot.latitude, longitude: snapshot.longitude }
        : null,
    timezone: snapshot.timeZone ?? fallbackTimezone,
    hours: snapshot.regularHours.slice(0, 21).map((h) => ({
      day: DAYS[h.day],
      opens: h.open,
      closes: h.close,
    })),
    exception_hours: snapshot.specialHours.slice(0, 60).map((h) => ({
      valid_from: h.date,
      valid_through: h.date,
      ...(!h.closed && h.open && h.close
        ? { opens: h.open, closes: h.close }
        : {}),
    })),
  };
}

/** Fills the ficha's address from the location list when the details lack it. */
function withListingAddress(
  snapshot: LocationSnapshot,
  option: LocationOption,
): LocationSnapshot {
  if (snapshot.address || !option.address) return snapshot;
  return {
    ...snapshot,
    address: {
      lines: [option.address],
      locality: null,
      administrativeArea: null,
      postalCode: null,
      countryCode: "",
    },
  };
}

async function unitMatches(
  tx: ContextTransaction,
  ctx: RequestContext,
  snapshot: LocationSnapshot,
): Promise<UnitMatch[]> {
  const [units, linked] = await Promise.all([
    tx.workspaceLocation.findMany({
      where: { workspaceId: ctx.workspaceId, status: "active" },
      select: { id: true, name: true, address: true },
      take: 200,
    }),
    tx.gbLocation.findMany({
      where: { workspaceId: ctx.workspaceId, unitId: { not: null } },
      select: { unitId: true },
    }),
  ]);
  const taken = new Set(linked.map((l) => l.unitId));
  return units
    .filter((unit) => !taken.has(unit.id))
    .filter((unit) =>
      sameAddress(snapshot, (unit.address ?? {}) as UnitAddress),
    )
    .map((unit) => {
      const address = (unit.address ?? {}) as UnitAddress;
      return {
        id: unit.id,
        name: unit.name,
        address: [address.street_address, address.address_locality]
          .filter(Boolean)
          .join(", "),
      };
    });
}

export async function prepareLocation(
  db: Db,
  ctx: RequestContext,
  provider: GoogleBusinessProvider,
  pending: string,
  optionId: string,
): Promise<PreparedLocation> {
  await db((tx) => requireManager(tx, ctx));
  const options = await provider.listLocations(pending);
  const option = options.find((o) => o.id === optionId);
  if (!option) throw gbNotFound();
  const connected = await provider.selectLocation(pending, option);
  const snapshot = withListingAddress(
    await provider.readLocation(connected),
    option,
  );
  const reviews = await provider.listReviews(connected, REVIEWS_READ_LIMIT);

  return db(async (tx) => {
    const actor = await requireManager(tx, ctx);
    const existing = await tx.gbLocation.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        provider: provider.kind,
        externalId: connected.externalId,
      },
      select: { id: true, unitId: true, name: true },
    });
    if (existing?.unitId) {
      throw gbConflict(
        "Esta ficha já está ligada a uma unidade.",
        "alreadyLinked",
      );
    }
    const location =
      existing ??
      (await tx.gbLocation.create({
        data: {
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          provider: provider.kind,
          externalId: connected.externalId,
          accountRef: connected.accountRef,
          placeId: snapshot.placeId,
          name: (snapshot.name || option.name).slice(0, 200),
          createdBy: ctx.userId,
        },
        select: { id: true, unitId: true, name: true },
      }));
    if (!existing) {
      await tx.gbSnapshot.create({
        data: {
          gbLocationId: location.id,
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          kind: "initial",
          data: snapshot as unknown as Prisma.InputJsonValue,
          reviews: reviews as unknown as Prisma.InputJsonValue,
          createdBy: ctx.userId,
        },
      });
      await recordAudit(tx, ctx, {
        action: "google_business.location.connect",
        resourceType: "gb_location",
        resourceId: location.id,
        result: "success",
        origin: actor === "partner" ? "admin" : "app",
        metadata: { provider: provider.kind, kind: actor },
      });
    }
    await seedAnalysisRuns(tx, ctx, location.id);
    return {
      locationId: location.id,
      name: location.name,
      unitId: location.unitId,
      matches: await unitMatches(tx, ctx, snapshot),
    };
  });
}

export const AttachInput = z.union([
  z.strictObject({ unitId: z.uuid() }),
  z.strictObject({ create: z.literal(true) }),
]);

export async function attachUnit(
  tx: ContextTransaction,
  ctx: RequestContext,
  locationId: string,
  input: z.infer<typeof AttachInput>,
): Promise<{ unitId: string; created: boolean }> {
  const actor = await requireManager(tx, ctx);
  const location = await tx.gbLocation.findFirst({
    where: { id: locationId, workspaceId: ctx.workspaceId },
    select: { id: true, unitId: true },
  });
  if (!location) throw gbNotFound();
  if (location.unitId) return { unitId: location.unitId, created: false };
  const origin = actor === "partner" ? ("admin" as const) : ("app" as const);

  let unitId: string;
  let created = false;
  if ("unitId" in input) {
    const unit = await tx.workspaceLocation.findFirst({
      where: {
        id: input.unitId,
        workspaceId: ctx.workspaceId,
        status: "active",
      },
      select: { id: true },
    });
    if (!unit) throw gbNotFound();
    const taken = await tx.gbLocation.count({ where: { unitId: unit.id } });
    if (taken > 0) {
      throw gbConflict("Esta unidade já tem uma ficha.", "unitTaken");
    }
    unitId = unit.id;
  } else {
    const { snapshot } = await initialSnapshot(tx, locationId);
    const settings = await effectiveSettings(tx);
    const parsed = LocationInput.safeParse(
      unitFromSnapshot(snapshot, settings.values["region.timezone"]),
    );
    if (!parsed.success) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Os dados da ficha não formam uma unidade válida.",
        messageKey: "googleBusiness.errors.invalidUnit",
      });
    }
    const d = parsed.data;
    const unit = await tx.workspaceLocation.create({
      data: {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        name: d.name,
        address: d.address,
        latitude: d.geo?.latitude ?? null,
        longitude: d.geo?.longitude ?? null,
        timezone: d.timezone,
        hours: d.hours,
        exceptionHours: d.exception_hours,
        amenities: d.amenities,
        createdBy: ctx.userId,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: "workspace.location.create",
      resourceType: "workspace_location",
      resourceId: unit.id,
      result: "success",
      origin,
      metadata: { reason: "google_business_onboarding" },
    });
    unitId = unit.id;
    created = true;
  }

  await tx.gbLocation.update({
    where: { id: locationId },
    data: { unitId, onboardingStatus: "analyzing", updatedBy: ctx.userId },
  });
  await recordAudit(tx, ctx, {
    action: "google_business.location.link_unit",
    resourceType: "gb_location",
    resourceId: locationId,
    result: "success",
    origin,
    metadata: { target: unitId, status: created ? "created" : "linked" },
  });
  return { unitId, created };
}

export async function runBlockingAnalysis(
  db: Db,
  ctx: RequestContext,
  locationId: string,
  analysisKey: string,
): Promise<{ status: string; findings: number }> {
  const analysis = analysisByKey(analysisKey);
  if (!analysis || analysis.phase !== "blocking") throw gbNotFound();
  const input = await db(async (tx) => {
    await requireManager(tx, ctx);
    return locationForRun(tx, ctx, locationId);
  });
  const result = await runAnalysis(
    db,
    ctx,
    analysis,
    input,
    BLOCKING_TIMEOUT_MS,
  );
  return { status: result.status, findings: result.findings.length };
}

/** Blocking steps of the window, in registry order. */
export function blockingSteps(): { key: string; labelKey: string }[] {
  return analysesOfPhase("blocking").map((a) => ({
    key: a.key,
    labelKey: a.labelKey,
  }));
}

export async function finishOnboarding(
  tx: ContextTransaction,
  ctx: RequestContext,
  locationId: string,
  linkUrl: string | null = null,
): Promise<{ points: number; background: number }> {
  await requireManager(tx, ctx);
  const location = await tx.gbLocation.findFirst({
    where: { id: locationId, workspaceId: ctx.workspaceId },
    select: { id: true, unitId: true },
  });
  if (!location?.unitId) throw gbNotFound();
  const runs = await tx.gbAnalysisRun.findMany({
    where: { gbLocationId: locationId },
    select: { phase: true, status: true, findings: true },
  });
  const background = runs.filter(
    (r) => r.phase === "background" && r.status !== "done",
  ).length;
  if (background > 0) {
    await enqueueJob(
      tx,
      ctx,
      backgroundAnalysesJob,
      { locationId, ...(linkUrl ? { linkUrl } : {}) },
      { idempotencyKey: `google-business.background:${locationId}` },
    );
  }
  await tx.gbLocation.update({
    where: { id: locationId },
    data: { onboardingStatus: "ready", updatedBy: ctx.userId },
  });
  const points = runs
    .filter((r) => r.status === "done")
    .reduce(
      (sum, r) => sum + (Array.isArray(r.findings) ? r.findings.length : 0),
      0,
    );
  return { points, background };
}
