"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { effectiveSettings } from "@/core/settings/read";
import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  withContext,
} from "@/lib/prisma/with-context";
import { actionFailure } from "@/core/i18n/errors";

import { KNOWN_AMENITIES } from "./amenities";
import { createLocation, DAYS, updateLocation } from "./service";

/** Server actions of Configurações › Lojas (F5a). */

type State = PartnerActionState;

const failure = (err: unknown): Promise<State> => actionFailure(err);

function str(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : undefined;
}

function num(formData: FormData, name: string): number | undefined {
  const value = str(formData, name);
  return value === undefined ? undefined : Number(value.replace(",", "."));
}

/** Time zone of a store left empty: the workspace's (CF1). */
async function workspaceTimezone(tx: ContextTransaction): Promise<string> {
  return (await effectiveSettings(tx)).values["region.timezone"];
}

/** Location fields from the form, in the UCP shape the service validates. */
function locationFromForm(formData: FormData, defaultTimezone: string) {
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
    timezone: str(formData, "timezone") ?? defaultTimezone,
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
    const location = await withContext(prisma, ctx, async (tx) =>
      createLocation(
        tx,
        ctx,
        locationFromForm(formData, await workspaceTimezone(tx)),
      ),
    );
    revalidatePath(`/app/${workspaceSlug}/settings/locations`);
    return {
      success: true,
      message: (await getTranslations("locations"))("created"),
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
    await withContext(prisma, ctx, async (tx) =>
      updateLocation(
        tx,
        ctx,
        locationId,
        status
          ? { status }
          : {
              ...locationFromForm(formData, await workspaceTimezone(tx)),
              exception_hours: undefined,
            },
      ),
    );
    revalidatePath(`/app/${workspaceSlug}/settings/locations`);
    const t = await getTranslations("locations");
    return {
      success: true,
      message: status
        ? status === "active"
          ? t("reactivated")
          : t("deactivated")
        : t("saved"),
    };
  } catch (err) {
    return failure(err);
  }
}
