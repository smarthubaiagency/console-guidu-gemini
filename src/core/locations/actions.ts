"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { toSafeError } from "@/shared/errors";

import { KNOWN_AMENITIES } from "./amenities";
import { createLocation, DAYS, updateLocation } from "./service";

/** Server actions of Configurações › Lojas (F5a). */

type State = PartnerActionState;

function failure(err: unknown): State {
  const safe = toSafeError(err);
  return {
    error: safe.safeMessage,
    code: safe.code,
    requestId: safe.requestId,
  };
}

function str(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : undefined;
}

function num(formData: FormData, name: string): number | undefined {
  const value = str(formData, name);
  return value === undefined ? undefined : Number(value.replace(",", "."));
}

/** Location fields from the form, in the UCP shape the service validates. */
function locationFromForm(formData: FormData) {
  const latitude = num(formData, "latitude");
  const longitude = num(formData, "longitude");
  const hours = DAYS.flatMap((day) => {
    const opens = str(formData, `${day}_opens`);
    const closes = str(formData, `${day}_closes`);
    return opens && closes ? [{ day, opens, closes }] : [];
  });
  const amenities = Object.fromEntries(
    KNOWN_AMENITIES.filter((a) => formData.get(`amenity_${a.id}`) === "on").map(
      (a) => [a.id, { description: a.label }],
    ),
  );
  const address = Object.fromEntries(
    [
      "street_address",
      "extended_address",
      "address_locality",
      "address_region",
      "address_country",
      "postal_code",
      "phone_number",
    ].flatMap((key) => {
      const value = str(formData, key);
      return value === undefined ? [] : [[key, value]];
    }),
  );
  return {
    name: str(formData, "name") ?? "",
    address,
    geo:
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : null,
    timezone: str(formData, "timezone") ?? "America/Sao_Paulo",
    hours,
    amenities,
  };
}

async function context(formData: FormData) {
  const identity = await requireUser();
  const workspaceSlug = z
    .string()
    .min(1)
    .max(64)
    .parse(formData.get("workspaceSlug"));
  const ctx = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  return { workspaceSlug, ctx };
}

export async function createLocationAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { workspaceSlug, ctx } = await context(formData);
    const location = await withContext(prisma, ctx, (tx) =>
      createLocation(tx, ctx, locationFromForm(formData)),
    );
    revalidatePath(`/app/${workspaceSlug}/settings/locations`);
    return {
      success: true,
      message: "Loja cadastrada.",
      redirectTo: `/app/${workspaceSlug}/settings/locations/${location.id}`,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function updateLocationAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const { workspaceSlug, ctx } = await context(formData);
    const locationId = z.string().uuid().parse(formData.get("locationId"));
    const status = str(formData, "status");
    await withContext(prisma, ctx, (tx) =>
      updateLocation(
        tx,
        ctx,
        locationId,
        status
          ? { status }
          : { ...locationFromForm(formData), exception_hours: undefined },
      ),
    );
    revalidatePath(`/app/${workspaceSlug}/settings/locations`);
    return {
      success: true,
      message: status
        ? status === "active"
          ? "Loja reativada."
          : "Loja desativada."
        : "Loja salva.",
    };
  } catch (err) {
    return failure(err);
  }
}
