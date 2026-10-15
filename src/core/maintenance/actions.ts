"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { platformActor } from "@/core/partners/actors";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { invalidateMaintenance } from "./runtime";
import { endMaintenance, saveMaintenance } from "./service";
import {
  MAINTENANCE_TIME_ZONE,
  MAX_MESSAGE_LENGTH,
  zonedLocalToDate,
} from "./state";

/**
 * Server actions of Operações › Manutenção (CF5c): save the window and end
 * it now. Only /platform (AAL2, platform host, IP list); the service checks
 * the role and audits. The process that saves drops its cache at once; the
 * others see the change within 5 seconds.
 */

type State = PartnerActionState;

function text(formData: FormData, name: string, max: number): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw.slice(0, max) : "";
}

/** Empty is null; anything else must be a valid local date and time. */
function localDate(formData: FormData, name: string): Date | null {
  const raw = text(formData, name, 32).trim();
  if (raw === "") return null;
  const date = zonedLocalToDate(raw, MAINTENANCE_TIME_ZONE);
  if (!date) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Data ou hora inválida.",
      messageKey: "maintenance.errors.invalidDate",
    });
  }
  return date;
}

async function done(key: "saved" | "ended"): Promise<State> {
  invalidateMaintenance();
  revalidatePath("/", "layout");
  const t = await getTranslations("maintenance.messages");
  return { success: true, message: t(key) };
}

export async function saveMaintenanceAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformActor();
    // One character over the limit reaches the service, which refuses it.
    const message = (name: string) =>
      text(formData, name, MAX_MESSAGE_LENGTH + 1);
    const input = {
      enabled: formData.get("enabled") === "on",
      mode: text(formData, "mode", 32),
      startsAt: localDate(formData, "startsAt"),
      endsAt: localDate(formData, "endsAt"),
      messages: {
        "pt-BR": message("messagePtBr"),
        en: message("messageEn"),
        es: message("messageEs"),
      },
    };
    await withIdentityContext(prisma, actor.userId, (tx) =>
      saveMaintenance(
        tx,
        { userId: actor.userId, platformRole: actor.role },
        input,
      ),
    );
    return done("saved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function endMaintenanceAction(): Promise<State> {
  try {
    const actor = await platformActor();
    await withIdentityContext(prisma, actor.userId, (tx) =>
      endMaintenance(tx, { userId: actor.userId, platformRole: actor.role }),
    );
    return done("ended");
  } catch (err) {
    return actionFailure(err);
  }
}
