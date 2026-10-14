"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { isSettingKey, SETTINGS, type SettingLevel } from "./catalog";
import { saveSettings, type SettingsInput } from "./service";

/**
 * Server actions of the settings pages (CF1). The form names each value
 * `value:<key>` (several entries for a list) and each lock `lock:<key>`;
 * an empty value inherits from the level above.
 */

type State = PartnerActionState;

function readInput(formData: FormData, level: SettingLevel): SettingsInput {
  const keys = new Set<string>();
  for (const name of formData.keys()) {
    const [kind, key] = name.split(/:(.+)/);
    if ((kind === "value" || kind === "present") && key && isSettingKey(key)) {
      keys.add(key);
    }
  }
  const values: Record<string, unknown> = {};
  const locks: Record<string, boolean> = {};
  for (const key of keys) {
    if (!isSettingKey(key)) continue;
    const isList = Array.isArray(SETTINGS[key].default);
    // A list may come as several entries or as one comma-separated text.
    const entries = formData
      .getAll(`value:${key}`)
      .flatMap((entry) =>
        typeof entry !== "string"
          ? []
          : isList
            ? entry
                .split(/[,\s]+/)
                .map((part) =>
                  key === "region.currencies" ? part.toUpperCase() : part,
                )
            : [entry.trim()],
      )
      .filter((entry) => entry.length > 0);
    values[key] = isList
      ? entries.length > 0
        ? entries
        : null
      : (entries[0] ?? null);
    if (level !== "workspace") {
      locks[key] = formData.get(`lock:${key}`) === "on";
    }
  }
  return { values, locks };
}

async function saved(): Promise<State> {
  const t = await getTranslations("settings");
  return { success: true, message: t("saved") };
}

export async function savePlatformSettingsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireMfa();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    await withIdentityContext(prisma, identity.userId, (tx) =>
      saveSettings(
        tx,
        {
          level: "platform",
          userId: identity.userId,
          platformRole: admin?.status === "active" ? admin.role : null,
        },
        readInput(formData, "platform"),
      ),
    );
    revalidatePath("/", "layout");
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePartnerSettingsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        saveSettings(
          tx,
          {
            level: "partner",
            userId: actor.userId,
            partnerId: actor.partnerId,
            partnerRole: actor.partnerRole,
          },
          readInput(formData, "partner"),
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/", "layout");
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}

export async function saveWorkspaceSettingsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireUser();
    const slug = z.string().min(1).max(64).parse(formData.get("workspaceSlug"));
    const ctx = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      slug,
    );
    await withContext(prisma, ctx, (tx) =>
      saveSettings(
        tx,
        { level: "workspace", userId: identity.userId, ctx },
        readInput(formData, "workspace"),
      ),
    );
    revalidatePath("/", "layout");
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}
