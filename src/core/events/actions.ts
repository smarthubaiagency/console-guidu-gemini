"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { requestClientIp } from "@/core/security/ip-gate";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import {
  checkPresentedData,
  type PlatformEventsActor,
  readEventData,
  setKeychain,
} from "./platform";

/**
 * Server actions of Plataforma › Eventos (H1). Each one asks for MFA
 * (AAL2, the session of /platform) and the active platform role again;
 * the database repeats every check. Results go to the SmartStatusBanner.
 */

export type EventActionState = Readonly<{
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
  /** The data opened with `keychain`, as indented JSON. */
  data?: string;
  /** Outcome of a presented-data check. */
  seal?: "ok" | "mismatch" | "unknown_key";
}>;

async function platformActor(): Promise<PlatformEventsActor> {
  const identity = await requireMfa();
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    userId: identity.userId,
    platformRole: admin?.status === "active" ? admin.role : null,
  };
}

const viewInput = z.object({
  eventId: z.string().max(64),
  reason: z.string().max(2000),
});

/** Opens the data of an event with `keychain`: reason, MFA, audit. */
export async function viewEventDataAction(
  input: Readonly<{ eventId: string; reason: string }>,
): Promise<EventActionState> {
  try {
    const actor = await platformActor();
    const parsed = viewInput.parse(input);
    const ip = await requestClientIp();
    const data = await withIdentityContext(prisma, actor.userId, (tx) =>
      readEventData(tx, actor, {
        eventId: parsed.eventId,
        reason: parsed.reason,
        ip,
      }),
    );
    const t = await getTranslations("events.keychain");
    return {
      success: true,
      message: t("opened"),
      data: JSON.stringify(data, null, 2),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

const keychainInput = z.object({
  userId: z.string().max(64),
  enabled: z.boolean(),
});

/** The platform owner grants or removes `keychain`. */
export async function setKeychainAction(
  input: Readonly<{ userId: string; enabled: boolean }>,
): Promise<EventActionState> {
  try {
    const actor = await platformActor();
    const parsed = keychainInput.parse(input);
    await withIdentityContext(prisma, actor.userId, (tx) =>
      setKeychain(tx, actor, parsed.userId, parsed.enabled),
    );
    const t = await getTranslations("events.team");
    return {
      success: true,
      message: parsed.enabled ? t("granted") : t("revoked"),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

const presentedInput = z.object({
  eventId: z.string().max(64),
  json: z.string().max(20_000),
});

/** Does the data a customer presents give the event's seal? */
export async function checkPresentedDataAction(
  input: Readonly<{ eventId: string; json: string }>,
): Promise<EventActionState> {
  try {
    const actor = await platformActor();
    const parsed = presentedInput.parse(input);
    let presented: unknown;
    try {
      presented = JSON.parse(parsed.json);
    } catch {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Cole os dados em JSON.",
        messageKey: "events.errors.json",
      });
    }
    const seal = await withIdentityContext(prisma, actor.userId, (tx) =>
      checkPresentedData(tx, actor, parsed.eventId, presented),
    );
    if (!seal) {
      throw new AppError({
        code: "not_found",
        safeMessage: "Evento não encontrado.",
        messageKey: "events.errors.notFound",
      });
    }
    const t = await getTranslations("events.check");
    return { success: seal === "ok", message: t(seal), seal };
  } catch (err) {
    return actionFailure(err);
  }
}
