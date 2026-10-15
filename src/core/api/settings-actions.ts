"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { WORKSPACE_SCOPES } from "@/core/mcp/scopes";
import type { PartnerActionState } from "@/core/partners/actions";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import {
  type PlatformApiActor,
  saveApiSwitches,
  savePlanScopes,
} from "./settings";
import { invalidateApiSwitches } from "./switch-runtime";

/**
 * Server actions of Plataforma › Configurações › API (CF6b). Saving goes
 * through the settings cascade, which audits each change
 * (`platform.settings.save`).
 */

type State = PartnerActionState;

async function platformApiActor(): Promise<PlatformApiActor> {
  const identity = await requireMfa();
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    userId: identity.userId,
    platformRole: admin?.status === "active" ? admin.role : null,
  };
}

async function saved(): Promise<State> {
  const t = await getTranslations("apiSettings");
  return { success: true, message: t("messages.saved") };
}

export async function saveApiSwitchesAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformApiActor();
    await withIdentityContext(prisma, actor.userId, (tx) =>
      saveApiSwitches(tx, actor, {
        api: formData.get("api") === "on",
        mcp: formData.get("mcp") === "on",
      }),
    );
    invalidateApiSwitches();
    revalidatePath("/platform/settings/api");
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}

/** The form names each checkbox `scope:<planKey>` with the scope as value. */
export async function savePlanScopesAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformApiActor();
    const input: Record<string, string[]> = {};
    for (const plan of formData.getAll("plan").map(String)) {
      input[plan] = formData
        .getAll(`scope:${plan}`)
        .map(String)
        .filter((scope) =>
          (WORKSPACE_SCOPES as readonly string[]).includes(scope),
        );
    }
    await withIdentityContext(prisma, actor.userId, (tx) =>
      savePlanScopes(tx, actor, input),
    );
    revalidatePath("/", "layout");
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}
