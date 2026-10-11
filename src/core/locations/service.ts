import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

/**
 * Stores and properties of the business (F5a), in the shape of the UCP
 * Location (`common/types/location.json`): name, postal address, WGS 84
 * coordinates, weekly hours, date exceptions, IANA time zone and
 * amenities. They belong to the workspace, not to a module: the Portfolio,
 * Google Business and the AI agent read the same locations. Members read;
 * owner and admin manage. A location is deactivated, never deleted.
 */

export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 horas).");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD.");
const text = (max: number) => z.string().trim().max(max);

/** UCP PostalAddress (address_country in ISO 3166-1 alpha-2). */
export const PostalAddress = z
  .object({
    street_address: text(200).optional(),
    extended_address: text(200).optional(),
    address_locality: text(120).optional(),
    address_region: text(80).optional(),
    address_country: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/, "País em duas letras (BR).")
      .optional(),
    postal_code: text(20).optional(),
    phone_number: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{6,14}$/, "Telefone no formato +5511999990000.")
      .optional(),
  })
  .strict();

export const DailyHour = z
  .object({ day: z.enum(DAYS), opens: time, closes: time })
  .strict();

export const ExceptionHour = z
  .object({
    title: text(80).optional(),
    valid_from: date,
    valid_through: date,
    opens: time.optional(),
    closes: time.optional(),
  })
  .strict()
  .refine((e) => e.valid_from <= e.valid_through, "Período invertido.");

/** Reverse-domain amenity id (e.g. dev.ucp.amenity.parking). */
const amenityId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9_-]+)+$/, "Use um identificador reverso.");

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const fields = {
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  address: PostalAddress.default({}),
  geo: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .strict()
    .nullable()
    .optional(),
  timezone: z
    .string()
    .trim()
    .refine(isTimeZone, "Fuso horário inválido.")
    .default("America/Sao_Paulo"),
  hours: z.array(DailyHour).max(21).default([]),
  exception_hours: z.array(ExceptionHour).max(60).default([]),
  amenities: z
    .record(
      amenityId,
      z.object({ description: z.string().trim().min(1).max(80) }).strict(),
    )
    .default({}),
};

export const LocationInput = z.object(fields).strict();
export const LocationUpdateInput = z
  .object({
    name: fields.name,
    address: PostalAddress,
    geo: fields.geo,
    timezone: z.string().trim().refine(isTimeZone, "Fuso horário inválido."),
    hours: z.array(DailyHour).max(21),
    exception_hours: z.array(ExceptionHour).max(60),
    amenities: fields.amenities.unwrap(),
    status: z.enum(["active", "inactive"]),
  })
  .partial()
  .strict();

/** UCP Location plus the internal status. */
export type LocationView = Readonly<{
  id: string;
  name: string;
  address: z.infer<typeof PostalAddress>;
  geo: { latitude: number; longitude: number } | null;
  timezone: string;
  hours: z.infer<typeof DailyHour>[];
  exception_hours: z.infer<typeof ExceptionHour>[];
  amenities: Record<string, { description: string }>;
  status: "active" | "inactive";
}>;

type Row = Prisma.WorkspaceLocationGetPayload<object>;

export function toLocationView(row: Row): LocationView {
  return {
    id: row.id,
    name: row.name,
    address: (row.address ?? {}) as LocationView["address"],
    geo:
      row.latitude !== null && row.longitude !== null
        ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
        : null,
    timezone: row.timezone,
    hours: (row.hours ?? []) as LocationView["hours"],
    exception_hours: (row.exceptionHours ??
      []) as LocationView["exception_hours"],
    amenities: (row.amenities ?? {}) as LocationView["amenities"],
    status: row.status === "inactive" ? "inactive" : "active",
  };
}

function invalid(error: z.ZodError): AppError {
  const issue = error.issues[0];
  return new AppError({
    code: "invalid_input",
    safeMessage: issue
      ? `${issue.path.join(".") || "loja"}: ${issue.message}`
      : "Dados da loja inválidos.",
  });
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Loja não encontrada.",
  });
}

export async function listLocations(
  tx: ContextTransaction,
  ctx: RequestContext,
  options: Readonly<{ includeInactive?: boolean }> = {},
): Promise<LocationView[]> {
  await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_READ);
  const rows = await tx.workspaceLocation.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(options.includeInactive ? {} : { status: "active" }),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: 200,
  });
  return rows.map(toLocationView);
}

export async function getLocation(
  tx: ContextTransaction,
  ctx: RequestContext,
  locationId: string,
): Promise<LocationView> {
  await requireWorkspacePermission(tx, ctx, Permissions.WORKSPACE_READ);
  if (!z.string().uuid().safeParse(locationId).success) throw notFound();
  const row = await tx.workspaceLocation.findFirst({
    where: { id: locationId, workspaceId: ctx.workspaceId },
  });
  if (!row) throw notFound();
  return toLocationView(row);
}

/** Ids of active locations of the workspace among the given ones. */
export async function activeLocationIds(
  tx: ContextTransaction,
  ctx: RequestContext,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.workspaceLocation.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: "active",
      id: { in: [...ids] },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function createLocation(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<LocationView> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_LOCATIONS_MANAGE,
  );
  const parsed = LocationInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const d = parsed.data;
  const row = await tx.workspaceLocation.create({
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
  });
  await recordAudit(tx, ctx, {
    action: "workspace.location.create",
    resourceType: "workspace_location",
    resourceId: row.id,
    result: "success",
  });
  return toLocationView(row);
}

export async function updateLocation(
  tx: ContextTransaction,
  ctx: RequestContext,
  locationId: string,
  input: unknown,
): Promise<LocationView> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_LOCATIONS_MANAGE,
  );
  const parsed = LocationUpdateInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  if (!z.string().uuid().safeParse(locationId).success) throw notFound();
  const d = parsed.data;
  const changed = await tx.workspaceLocation.updateMany({
    where: { id: locationId, workspaceId: ctx.workspaceId },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.address !== undefined ? { address: d.address } : {}),
      ...(d.geo !== undefined
        ? {
            latitude: d.geo?.latitude ?? null,
            longitude: d.geo?.longitude ?? null,
          }
        : {}),
      ...(d.timezone !== undefined ? { timezone: d.timezone } : {}),
      ...(d.hours !== undefined ? { hours: d.hours } : {}),
      ...(d.exception_hours !== undefined
        ? { exceptionHours: d.exception_hours }
        : {}),
      ...(d.amenities !== undefined ? { amenities: d.amenities } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      updatedBy: ctx.userId,
    },
  });
  if (changed.count === 0) throw notFound();
  await recordAudit(tx, ctx, {
    action: "workspace.location.update",
    resourceType: "workspace_location",
    resourceId: locationId,
    result: "success",
    metadata: d.status ? { status: d.status } : {},
  });
  return getLocation(tx, ctx, locationId);
}
